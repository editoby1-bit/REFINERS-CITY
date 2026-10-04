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
  if (RECORD_COLLECTIONS.includes(row.collection)) {
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

function applyProfileToDb(db, profile) {
  const user = profileToUser(profile);
  db.users = db.users.filter(u => u.id !== user.id);
  db.pendingUsers = db.pendingUsers.filter(u => u.id !== user.id);
  (user.approved ? db.users : db.pendingUsers).push(user);
}

async function fetchAllRows(table, orderColumns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = cloud.from(table).select('*');
    orderColumns.forEach(column => { query = query.order(column); });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

// Replace state.db with what the server has (the user only sees what security rules allow).
async function loadCloudData() {
  const [profiles, records] = await Promise.all([
    fetchAllRows('profiles', ['id']),
    fetchAllRows('records', ['collection', 'id']),
  ]);
  const db = emptyDb();
  profiles.forEach(profile => applyProfileToDb(db, profile));
  records.forEach(row => applyRecordToDb(db, row));
  state.db = db;
  cloudSync.snapshot = new Map(records.map(row => [recordKey(row.collection, row.id), stableStringify(row.data)]));
  cloudSync.profileSnapshot = new Map(allProfileUsers(db).map(user => [user.id, stableStringify(userToProfileFields(user))]));
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
    const upserts = [];
    current.forEach((row, key) => {
      const json = stableStringify(row.data);
      if (cloudSync.snapshot.get(key) !== json) upserts.push({ key, json, row });
    });
    const deletes = [...cloudSync.snapshot.keys()].filter(key => !current.has(key));

    for (const batch of chunk(upserts, WRITE_CHUNK)) {
      const { error } = await cloud.from('records').upsert(batch.map(({ row }) => ({
        collection: row.collection,
        id: row.id,
        data: row.data,
        updated_at: new Date().toISOString(),
        updated_by: state.cloudUserId,
      })));
      if (error) throw error;
      batch.forEach(({ key, json }) => cloudSync.snapshot.set(key, json));
    }

    const deletesByCollection = new Map();
    deletes.forEach(key => {
      const [collection, id] = key.split('\u0000');
      if (!deletesByCollection.has(collection)) deletesByCollection.set(collection, []);
      deletesByCollection.get(collection).push(id);
    });
    for (const [collection, ids] of deletesByCollection) {
      for (const batch of chunk(ids, 200)) {
        const { error } = await cloud.from('records').delete().eq('collection', collection).in('id', batch);
        if (error) throw error;
        batch.forEach(id => cloudSync.snapshot.delete(recordKey(collection, id)));
      }
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
  // Network trouble: keep the change in memory and try again shortly.
  setSyncStatus('error');
  clearTimeout(cloudSync.timer);
  cloudSync.timer = setTimeout(runCloudSync, 5000);
}

function subscribeToCloudChanges() {
  unsubscribeFromCloudChanges();
  cloudSync.channel = cloud.channel('church-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, handleRemoteRecordChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handleRemoteProfileChange)
    .subscribe();
}

function unsubscribeFromCloudChanges() {
  if (cloudSync.channel) cloud.removeChannel(cloudSync.channel);
  cloudSync.channel = null;
}

function handleRemoteRecordChange(payload) {
  if (payload.eventType === 'DELETE') {
    const { collection, id } = payload.old || {};
    if (!collection || !id) return;
    removeRecordFromDb(state.db, collection, id);
    cloudSync.snapshot.delete(recordKey(collection, id));
  } else {
    const row = payload.new;
    // Our own writes echo back; local state is already newer or equal.
    if (!row || row.updated_by === state.cloudUserId) return;
    applyRecordToDb(state.db, row);
    cloudSync.snapshot.set(recordKey(row.collection, row.id), stableStringify(row.data));
  }
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

// Changes from other devices: re-render, unless that would wipe something the user is typing.
function hasUnsavedInput() {
  return qq('#app input, #app textarea, #app select').some(el => {
    if (el.matches('[data-attendance-member]') || el.type === 'file' || el.type === 'hidden') return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') return [...el.options].some(option => option.selected !== option.defaultSelected);
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
