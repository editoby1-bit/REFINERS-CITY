// Online database (Supabase). Active when config.js has a project URL and anon key;
// otherwise the app falls back to storing everything in this browser.
const CLOUD_CONFIG = window.REFINERS_CONFIG || {};
const CLOUD_ENABLED = Boolean(CLOUD_CONFIG.supabaseUrl && CLOUD_CONFIG.supabaseAnonKey && window.supabase);
const cloud = CLOUD_ENABLED ? window.supabase.createClient(CLOUD_CONFIG.supabaseUrl, CLOUD_CONFIG.supabaseAnonKey) : null;

// A throwaway client that never touches the signed-in user's session.
function createDetachedCloudClient(storageKey) {
  return window.supabase.createClient(CLOUD_CONFIG.supabaseUrl, CLOUD_CONFIG.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey },
  });
}

// Every array in state.db except users is stored as rows of the "records" table.
const RECORD_COLLECTIONS = ['members', 'prospects', 'areas', 'serviceTemplates', 'serviceEvents', 'attendance', 'messageRules'];
const PAGE_SIZE = 1000;
const WRITE_CHUNK = 500;

const cloudSync = {
  snapshot: new Map(),        // record key -> stable JSON of what the server has
  profileSnapshot: new Map(), // profile id -> stable JSON of what the server has
  timer: null,
  running: false,
  again: false,
  status: 'saved',
  channel: null,
  highWater: '',      // newest server change time this device has downloaded
  lastRefreshAt: 0,
  refreshing: false,
  retryDelay: 0,
  resumeLiveAfterSync: false,
  hiddenTimer: null,
};

function emptyDb() {
  return {
    users: [],
    pendingUsers: [],
    areas: [],
    members: [],
    prospects: [],
    serviceTemplates: [],
    serviceEvents: [],
    attendance: [],
    messageRules: [],
    automationLog: [],
    dismissedDefaultServices: [],
    lastBackupAt: '',
    session: null,
  };
}

// jsonb does not keep key order, so compare records with keys sorted.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const recordKey = (collection, id) => `${collection}\u0000${id}`;

function dbToRecordMap(db) {
  const map = new Map();
  RECORD_COLLECTIONS.forEach(collection => {
    (db[collection] || []).forEach(item => {
      if (item && item.id) map.set(recordKey(collection, item.id), { collection, id: item.id, data: item });
    });
  });
  (db.automationLog || []).forEach(token => {
    map.set(recordKey('automationLog', token), { collection: 'automationLog', id: token, data: { token } });
  });
  map.set(recordKey('meta', 'settings'), {
    collection: 'meta',
    id: 'settings',
    data: { dismissedDefaultServices: db.dismissedDefaultServices || [], lastBackupAt: db.lastBackupAt || '' },
  });
  return map;
}

function profileToUser(profile) {
  return {
    id: profile.id,
    email: profile.email || '',
    name: profile.name || '',
    role: profile.role,
    className: profile.class_name || '',
    areaId: profile.area_id || '',
    approved: Boolean(profile.approved),
    createdAt: profile.created_at || '',
  };
}

function userToProfileFields(user) {
  return {
    name: user.name || '',
    role: user.role,
    class_name: user.className || '',
    area_id: user.areaId || '',
    approved: Boolean(user.approved),
  };
}

function allProfileUsers(db) {
  return [...(db.users || []), ...(db.pendingUsers || [])];
}

function applyRecordToDb(db, row) {
  if (row.deleted) {
    removeRecordFromDb(db, row.collection, row.id);
  } else if (RECORD_COLLECTIONS.includes(row.collection)) {
    const list = db[row.collection];
    const index = list.findIndex(item => item.id === row.id);
    if (index >= 0) list[index] = row.data;
    else list.push(row.data);
  } else if (row.collection === 'automationLog') {
    if (!db.automationLog.includes(row.id)) db.automationLog.push(row.id);
  } else if (row.collection === 'meta' && row.id === 'settings') {
    db.dismissedDefaultServices = row.data.dismissedDefaultServices || [];
    db.lastBackupAt = row.data.lastBackupAt || '';
  }
}

function removeRecordFromDb(db, collection, id) {
  if (RECORD_COLLECTIONS.includes(collection)) {
    db[collection] = db[collection].filter(item => item.id !== id);
  } else if (collection === 'automationLog') {
    db.automationLog = db.automationLog.filter(token => token !== id);
  }
}

// Builds state.db from many rows in one pass (applyRecordToDb is for a handful of changes).
function buildDbFromRows(rows) {
  const db = emptyDb();
  rows.forEach(row => {
    if (row.deleted) return;
    if (RECORD_COLLECTIONS.includes(row.collection)) db[row.collection].push(row.data);
    else applyRecordToDb(db, row);
  });
  return db;
}

function applyProfileToDb(db, profile) {
  const user = profileToUser(profile);
  db.users = db.users.filter(u => u.id !== user.id);
  db.pendingUsers = db.pendingUsers.filter(u => u.id !== user.id);
  (user.approved ? db.users : db.pendingUsers).push(user);
}

// --- Saving data use -----------------------------------------------------------
// Each device keeps a copy of the records it has downloaded (IndexedDB) and afterwards only
// asks the database for what changed since. The online database stays the source of truth:
// the copy is only used to avoid downloading everything again on every visit.
const RECORD_COLUMNS = 'collection,id,data,updated_at,updated_by,deleted,client_id';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // tombstones are purged after 45 days
const CHANGE_MARGIN_MS = 60 * 1000;               // re-check the last minute before each check for slow saves
const REFRESH_MIN_GAP_MS = 30 * 1000;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const HIDDEN_DISCONNECT_MS = 5 * 60 * 1000;
const CLIENT_ID = (() => {
  try {
    const saved = localStorage.getItem('refiners-client-id');
    if (saved) return saved;
    const id = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem('refiners-client-id', id);
    return id;
  } catch {
    return `c_${Math.random().toString(36).slice(2)}`;
  }
})();

const recordCache = {
  dbName: () => `refiners-city-${(CLOUD_CONFIG.supabaseUrl || '').replace(/\W+/g, '-')}-${state.cloudUserId}`,
  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB || !state.cloudUserId) return reject(new Error('no cache'));
      const request = indexedDB.open(this.dbName(), 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records', { keyPath: 'key' });
        request.result.createObjectStore('meta', { keyPath: 'name' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async read() {
    try {
      const idb = await this.open();
      const tx = idb.transaction(['records', 'meta'], 'readonly');
      const rowsReq = tx.objectStore('records').getAll();
      const metaReq = tx.objectStore('meta').get('sync');
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      idb.close();
      const meta = metaReq.result;
      if (!meta?.highWater || Date.now() - Date.parse(meta.savedAt) > CACHE_MAX_AGE_MS) return null;
      return { rows: rowsReq.result, highWater: meta.highWater };
    } catch {
      return null;
    }
  },
  // puts: rows to store, removes: keys to drop, replaceAll: start from empty.
  async write({ puts = [], removes = [], replaceAll = false, highWater } = {}) {
    try {
      const idb = await this.open();
      const tx = idb.transaction(['records', 'meta'], 'readwrite');
      const store = tx.objectStore('records');
      if (replaceAll) store.clear();
      puts.forEach(row => store.put({ key: recordKey(row.collection, row.id), collection: row.collection, id: row.id, data: row.data }));
      removes.forEach(key => store.delete(key));
      if (highWater) tx.objectStore('meta').put({ name: 'sync', highWater, savedAt: new Date().toISOString() });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      idb.close();
    } catch (error) {
      console.warn('Could not update the offline copy', error);
    }
  },
  async clear() {
    try {
      if (window.indexedDB && state.cloudUserId) indexedDB.deleteDatabase(this.dbName());
    } catch {}
  },
};

function databaseUpdateError(error) {
  if (error && (error.code === '42703' || error.code === 'PGRST204' || /column .*(deleted|client_id)/i.test(error.message || ''))) {
    return new Error('The online database needs an update: open Supabase > SQL Editor and run supabase/setup.sql again.');
  }
  return error;
}

async function fetchProfiles() {
  const { data, error } = await cloud.from('profiles').select('*').order('id').limit(PAGE_SIZE);
  if (error) throw error;
  return data;
}

// Full download, one collection at a time, paging by id (fast even for large tables).
async function fetchAllRecords() {
  const rows = [];
  const collections = [...RECORD_COLLECTIONS, 'automationLog', 'meta'];
  for (const collection of collections) {
    let lastId = null;
    for (;;) {
      let query = cloud.from('records').select(RECORD_COLUMNS).eq('collection', collection).eq('deleted', false).order('id').limit(PAGE_SIZE);
      if (lastId !== null) query = query.gt('id', lastId);
      const { data, error } = await query;
      if (error) throw databaseUpdateError(error);
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
      lastId = data[data.length - 1].id;
    }
  }
  return rows;
}

function latestTimestamp(rows, current = '') {
  return rows.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), current || '');
}

// "Everything changed before this moment has been downloaded": the database clock at the
// start of a download, minus a margin for saves that were still finishing.
async function downloadMark() {
  const { data, error } = await cloud.rpc('server_time');
  if (error || !data) return null;
  return new Date(Date.parse(data) - CHANGE_MARGIN_MS).toISOString();
}

function laterMark(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// Load what this account may see: the device copy plus changes, or a full download.
async function loadCloudData() {
  const profiles = await fetchProfiles();
  const me = profiles.find(profile => profile.id === state.cloudUserId);
  let cached = null;
  let rows = [];
  if (me?.approved) {
    cached = await recordCache.read();
    if (!cached) {
      const mark = await downloadMark();
      rows = await fetchAllRecords();
      // Without the database clock (older setup), fall back to the newest change downloaded.
      cloudSync.highWater = mark || (latestTimestamp(rows) ? new Date(Date.parse(latestTimestamp(rows)) - CHANGE_MARGIN_MS).toISOString() : new Date(0).toISOString());
      await recordCache.write({ puts: rows, replaceAll: true, highWater: cloudSync.highWater });
    } else {
      rows = cached.rows;
      cloudSync.highWater = cached.highWater;
    }
  }
  const db = buildDbFromRows(rows);
  profiles.forEach(profile => applyProfileToDb(db, profile));
  state.db = db;
  cloudSync.snapshot = new Map(rows.map(row => [recordKey(row.collection, row.id), stableStringify(row.data)]));
  cloudSync.profileSnapshot = new Map(allProfileUsers(db).map(user => [user.id, stableStringify(userToProfileFields(user))]));
  cloudSync.lastRefreshAt = Date.now();
  if (cached) await fetchCloudChanges();
}

// Download only rows changed since the last check (including deletions).
async function fetchCloudChanges() {
  if (!state.cloudUserId || !cloudSync.highWater || !getCurrentUser()?.approved) return 0;
  const since = cloudSync.highWater;
  const mark = await downloadMark();
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await cloud.from('records').select(RECORD_COLUMNS)
      .gt('updated_at', since).order('updated_at').order('collection').order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw databaseUpdateError(error);
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  cloudSync.lastRefreshAt = Date.now();
  let changed = 0;
  rows.forEach(row => {
    const key = recordKey(row.collection, row.id);
    const json = row.deleted ? null : stableStringify(row.data);
    if (row.deleted ? !cloudSync.snapshot.has(key) : cloudSync.snapshot.get(key) === json) return;
    applyRecordToDb(state.db, row);
    if (row.deleted) cloudSync.snapshot.delete(key);
    else cloudSync.snapshot.set(key, json);
    changed += 1;
  });
  const newest = latestTimestamp(rows);
  cloudSync.highWater = laterMark(cloudSync.highWater,
    mark || (newest ? new Date(Date.parse(newest) - CHANGE_MARGIN_MS).toISOString() : ''));
  await recordCache.write({
    puts: rows.filter(row => !row.deleted),
    removes: rows.filter(row => row.deleted).map(row => recordKey(row.collection, row.id)),
    highWater: cloudSync.highWater,
  });
  return changed;
}

// Check for changes when coming back to the app, or every 10 minutes while it is open.
async function refreshFromCloud({ force = false } = {}) {
  if (!state.cloudUserId || cloudSync.refreshing) return;
  // Never overwrite local edits that are still on their way to the database.
  if (cloudSync.status !== 'saved' || cloudSync.running) return;
  if (!force && Date.now() - (cloudSync.lastRefreshAt || 0) < REFRESH_MIN_GAP_MS) return;
  cloudSync.refreshing = true;
  try {
    const changed = await fetchCloudChanges();
    if (changed) requestRemoteRender();
  } catch (error) {
    console.warn('Could not check for changes', error);
  } finally {
    cloudSync.refreshing = false;
  }
}

function setSyncStatus(status) {
  cloudSync.status = status;
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  badge.className = `badge ${status === 'error' ? 'danger-badge' : status === 'saving' ? 'warn' : 'success'}`;
  badge.textContent = syncStatusLabel();
}

function syncStatusLabel() {
  if (cloudSync.status === 'saving') return 'Saving…';
  if (cloudSync.status === 'error') return 'Not saved — retrying';
  return 'All changes saved';
}

function scheduleCloudSync() {
  setSyncStatus('saving');
  clearTimeout(cloudSync.timer);
  cloudSync.timer = setTimeout(runCloudSync, 250);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Attendance rows never change after they are created, so their JSON is computed once.
const attendanceJsonCache = new WeakMap();
function recordJson(row) {
  if (row.collection !== 'attendance') return stableStringify(row.data);
  let json = attendanceJsonCache.get(row.data);
  if (!json) {
    json = stableStringify(row.data);
    attendanceJsonCache.set(row.data, json);
  }
  return json;
}

// Push the difference between state.db and the last known server state.
async function runCloudSync() {
  if (!state.cloudUserId) return;
  if (cloudSync.running) {
    cloudSync.again = true;
    return;
  }
  cloudSync.running = true;
  try {
    const current = dbToRecordMap(state.db);
    const writes = [];
    current.forEach((row, key) => {
      const json = recordJson(row);
      if (cloudSync.snapshot.get(key) !== json) writes.push({ key, json, row });
    });
    // Deletions are written as small tombstones so other devices learn about them.
    [...cloudSync.snapshot.keys()].filter(key => !current.has(key)).forEach(key => {
      const [collection, id] = key.split('\u0000');
      writes.push({ key, json: null, row: { collection, id, data: {}, deleted: true } });
    });

    for (const batch of chunk(writes, WRITE_CHUNK)) {
      const { error } = await cloud.from('records').upsert(batch.map(({ row }) => ({
        collection: row.collection,
        id: row.id,
        data: row.data,
        deleted: Boolean(row.deleted),
        updated_by: state.cloudUserId,
        client_id: CLIENT_ID,
      })));
      if (error) throw databaseUpdateError(error);
      batch.forEach(({ key, json }) => {
        if (json === null) cloudSync.snapshot.delete(key);
        else cloudSync.snapshot.set(key, json);
      });
      await recordCache.write({
        puts: batch.filter(({ json }) => json !== null).map(({ row }) => row),
        removes: batch.filter(({ json }) => json === null).map(({ key }) => key),
      });
    }

    const users = allProfileUsers(state.db);
    for (const user of users) {
      const fields = userToProfileFields(user);
      const json = stableStringify(fields);
      if (cloudSync.profileSnapshot.has(user.id) && cloudSync.profileSnapshot.get(user.id) !== json) {
        const { error } = await cloud.from('profiles').update(fields).eq('id', user.id);
        if (error) throw error;
        cloudSync.profileSnapshot.set(user.id, json);
      }
    }
    const userIds = new Set(users.map(u => u.id));
    for (const id of [...cloudSync.profileSnapshot.keys()].filter(id => !userIds.has(id))) {
      const { error } = await cloud.from('profiles').delete().eq('id', id);
      if (error) throw error;
      cloudSync.profileSnapshot.delete(id);
    }

    setSyncStatus('saved');
  } catch (error) {
    await handleCloudSyncError(error);
  } finally {
    cloudSync.running = false;
  }
  if (cloudSync.again) {
    cloudSync.again = false;
    runCloudSync();
  } else if (cloudSync.status === 'saved' && cloudSync.resumeLiveAfterSync) {
    cloudSync.resumeLiveAfterSync = false;
    subscribeToCloudChanges();
  }
}

async function handleCloudSyncError(error) {
  console.error('Sync failed', error);
  // Permission problems will never succeed on retry: undo the local change by reloading.
  const rejected = error?.code === '42501' || error?.code === 'P0001' || /row-level security|permission/i.test(error?.message || '');
  if (rejected) {
    showNotice(error?.code === 'P0001' ? error.message : 'You do not have permission to make that change, so it was undone.', 'error');
    try {
      await loadCloudData();
      setSyncStatus('saved');
    } catch (reloadError) {
      console.error('Reload failed', reloadError);
      setSyncStatus('error');
    }
    render();
    return;
  }
  if (/needs an update/.test(error?.message || '')) showNotice(error.message, 'error');
  // Network trouble: keep the change in memory and try again, backing off up to a minute.
  setSyncStatus('error');
  cloudSync.retryDelay = Math.min((cloudSync.retryDelay || 2500) * 2, 60000);
  clearTimeout(cloudSync.timer);
  cloudSync.timer = setTimeout(() => {
    runCloudSync().then(() => { if (cloudSync.status === 'saved') cloudSync.retryDelay = 0; });
  }, cloudSync.retryDelay);
}

// Live updates use a realtime connection (free plan: 200 at once, 2 million messages a month).
// Hidden tabs let go of theirs after 5 minutes and catch up when they are opened again.
function subscribeToCloudChanges() {
  unsubscribeFromCloudChanges();
  if (!state.cloudUserId) return;
  cloudSync.channel = cloud.channel('church-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, handleRemoteRecordChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handleRemoteProfileChange)
    .subscribe(status => {
      // Reconnected after a drop: fetch anything missed while disconnected.
      if (status === 'SUBSCRIBED') refreshFromCloud();
    });
}

function unsubscribeFromCloudChanges() {
  if (cloudSync.channel) cloud.removeChannel(cloudSync.channel);
  cloudSync.channel = null;
}

// Big imports: stop listening to our own flood of changes until the upload has finished.
function pauseLiveUpdatesUntilSaved() {
  unsubscribeFromCloudChanges();
  cloudSync.resumeLiveAfterSync = true;
}

function handleRemoteRecordChange(payload) {
  if (payload.eventType === 'DELETE') return; // only old tombstones are ever hard-deleted
  const row = payload.new;
  // Our own writes echo back; local state is already newer or equal.
  if (!row || row.client_id === CLIENT_ID) return;
  const key = recordKey(row.collection, row.id);
  applyRecordToDb(state.db, row);
  if (row.deleted) cloudSync.snapshot.delete(key);
  else cloudSync.snapshot.set(key, stableStringify(row.data));
  recordCache.write(row.deleted ? { removes: [key] } : { puts: [row] });
  requestRemoteRender();
}

async function handleRemoteProfileChange(payload) {
  const me = state.cloudUserId;
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return;
    state.db.users = state.db.users.filter(u => u.id !== id);
    state.db.pendingUsers = state.db.pendingUsers.filter(u => u.id !== id);
    cloudSync.profileSnapshot.delete(id);
  } else {
    const profile = payload.new;
    const wasApproved = Boolean(getCurrentUser()?.approved);
    applyProfileToDb(state.db, profile);
    cloudSync.profileSnapshot.set(profile.id, stableStringify(userToProfileFields(profileToUser(profile))));
    // Just approved by the Church Admin: now allowed to read church records.
    if (profile.id === me && profile.approved && !wasApproved) {
      await loadCloudData();
      render();
      return;
    }
  }
  requestRemoteRender();
}

if (CLOUD_ENABLED) {
  document.addEventListener('visibilitychange', () => {
    if (!state.cloudUserId) return;
    clearTimeout(cloudSync.hiddenTimer);
    if (document.hidden) {
      cloudSync.hiddenTimer = setTimeout(unsubscribeFromCloudChanges, HIDDEN_DISCONNECT_MS);
    } else {
      if (!cloudSync.channel && !cloudSync.resumeLiveAfterSync && getCurrentUser()?.approved) subscribeToCloudChanges();
      refreshFromCloud();
    }
  });
  window.addEventListener('online', () => {
    if (cloudSync.status === 'error') runCloudSync();
    refreshFromCloud({ force: true });
  });
  setInterval(() => {
    if (!document.hidden) refreshFromCloud();
  }, REFRESH_INTERVAL_MS);
  // Warn before closing the page while changes are still being saved.
  window.addEventListener('beforeunload', (event) => {
    if (state.cloudUserId && (cloudSync.status !== 'saved' || cloudSync.running)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}

// Changes from other devices: re-render, unless that would wipe something the user is typing.
function hasUnsavedInput() {
  return qq('#app input, #app textarea, #app select').some(el => {
    if (el.matches('[data-attendance-member]') || el.type === 'file' || el.type === 'hidden') return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') {
      // With no option marked "selected", the browser starts on the first one.
      const defaultIndex = [...el.options].findIndex(option => option.defaultSelected);
      return el.multiple
        ? [...el.options].some(option => option.selected !== option.defaultSelected)
        : el.selectedIndex !== (defaultIndex === -1 ? 0 : defaultIndex);
    }
    return el.value !== el.defaultValue;
  });
}

function requestRemoteRender() {
  const active = document.activeElement;
  const typing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && active.type !== 'checkbox';
  if (typing || hasUnsavedInput()) {
    state.remoteRenderPending = true;
    return;
  }
  render();
}

if (CLOUD_ENABLED) {
  setInterval(() => {
    if (state.remoteRenderPending) requestRemoteRender();
  }, 3000);
}
