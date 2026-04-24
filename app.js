const STORAGE_KEY = 'refiners_city_attendance_v3';

const q = (s, el = document) => el.querySelector(s);
const qq = (s, el = document) => Array.from(el.querySelectorAll(s));
const app = q('#app');

const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const isoDate = (date) => date.toISOString().slice(0, 10);
const nextWeekdayDate = (weekdayIndex) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const diff = (weekdayIndex - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return isoDate(date);
};
const nowStr = () => new Date().toISOString();
const fmtDate = (value) => value ? new Date(value).toLocaleDateString() : '—';
const fmtDateTime = (value) => value ? new Date(value).toLocaleString() : '—';
const escapeHtml = (text = '') => String(text)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const phoneDigits = (phone = '') => String(phone).replace(/\D/g, '');
const whatsappUrl = (phone, text) => `https://wa.me/${phoneDigits(phone)}?text=${encodeURIComponent(text)}`;

const LEVELS = {
  new: 'New Member',
  consistent: 'Consistent New Timer',
  strong: 'Strong Member',
};

const STATIC_SERVICE_TYPES = [
  'Sunday 1st Service',
  'Sunday 2nd Service',
  'Sunday 3rd Service',
  'Sunday 4th Service',
  'Midweek Service',
];

function defaultServiceTemplates() {
  return [
    { id: 'tmpl_sun_1', label: 'Sunday 1st Service', category: 'Sunday', dayOfWeek: 'Sunday', isStatutory: true, sortOrder: 1 },
    { id: 'tmpl_sun_2', label: 'Sunday 2nd Service', category: 'Sunday', dayOfWeek: 'Sunday', isStatutory: true, sortOrder: 2 },
    { id: 'tmpl_sun_3', label: 'Sunday 3rd Service', category: 'Sunday', dayOfWeek: 'Sunday', isStatutory: true, sortOrder: 3 },
    { id: 'tmpl_sun_4', label: 'Sunday 4th Service', category: 'Sunday', dayOfWeek: 'Sunday', isStatutory: true, sortOrder: 4 },
    { id: 'tmpl_midweek', label: 'Midweek Service', category: 'Midweek', dayOfWeek: 'Wednesday', isStatutory: true, sortOrder: 5 },
  ];
}


function ensureDefaultServiceTemplates(db) {
  db.serviceTemplates ||= [];
  defaultServiceTemplates().forEach(template => {
    if (!db.serviceTemplates.some(item => item.id === template.id || item.label === template.label)) {
      db.serviceTemplates.push({ ...template });
    }
  });
}

function defaultExistingServiceEvents(adminId = '') {
  const sunday = nextWeekdayDate(0);
  const wednesday = nextWeekdayDate(3);
  return defaultServiceTemplates().map(template => ({
    id: uid('event'),
    name: template.label,
    category: template.category,
    date: template.dayOfWeek === 'Wednesday' ? wednesday : sunday,
    custom: false,
    templateId: template.id,
    isDefaultSeed: true,
    createdByUserId: adminId,
    createdAt: nowStr(),
  }));
}

function ensureDefaultExistingServices(db) {
  db.serviceEvents ||= [];
  const adminId = db.users?.find(user => user.role === 'admin')?.id || '';
  defaultExistingServiceEvents(adminId).forEach(eventObj => {
    if (!db.serviceEvents.some(item => item.templateId === eventObj.templateId && item.date === eventObj.date)) {
      db.serviceEvents.push(eventObj);
    }
  });
}

const ROLE_LABELS = {
  admin: 'Church Admin',
  ordained: 'Ordained Pastor',
  g12: 'G12 Pastor',
  bishop: 'Bishop',
};

const state = {
  db: loadDb(),
  session: null,
  view: 'dashboard',
  modalMemberId: null,
  memberTab: 'members',
  messageAudienceType: 'everyone',
  mobileNavOpen: false,
  areaFocusId: '',
  g12FocusId: '',
  growthFocus: 'members',
  notice: null,
  areaPageCount: 10,
  memberPageCount: 50,
  editingAreaId: null,
  removingAreaId: null,
  editingG12Id: null,
  dialog: null,
  selectedAttendanceEventId: '',
  absenceFilters: { areaId: '', g12Id: '', level: '' },
};

function loadDb() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    parsed.automationLog ||= [];
    parsed.messageRules ||= [];
    parsed.prospects ||= [];
    parsed.serviceTemplates ||= defaultServiceTemplates();
    parsed.serviceEvents ||= [];
    ensureDefaultServiceTemplates(parsed);
    ensureDefaultExistingServices(parsed);
    parsed.attendance ||= [];
    parsed.members ||= [];
    parsed.areas ||= [];
    parsed.users ||= [];
    parsed.session ||= null;
    return parsed;
  }

  const adminId = uid('user');
  const ordainedId = uid('user');
  const g12Id = uid('user');
  const bishopId = uid('user');
  const area1 = uid('area');
  const area2 = uid('area');
  const classId = uid('g12class');
  const member1 = uid('member');
  const member2 = uid('member');
  const prospect1 = uid('prospect');
  const event1 = uid('event');
  const event2 = uid('event');
  const event3 = uid('event');
  const event4 = uid('event');
  const event5 = uid('event');
  const nextSunday = nextWeekdayDate(0);
  const nextWednesday = nextWeekdayDate(3);
  const thisYear = new Date().getFullYear();

  return {
    users: [
      { id: adminId, name: 'Church Admin', role: 'admin', email: 'admin@refiners.local', password: 'admin123', className: '', areaId: '', createdAt: nowStr() },
      { id: ordainedId, name: 'Pastor Daniel', role: 'ordained', email: 'ordained@refiners.local', password: 'pastor123', className: '', areaId: '', createdAt: nowStr() },
      { id: g12Id, name: 'Pastor Toby', role: 'g12', email: 'g12@refiners.local', password: 'g12pass', className: "Pastor Toby's Class", areaId: '', createdAt: nowStr() },
      { id: bishopId, name: 'Bishop Esther', role: 'bishop', email: 'bishop@refiners.local', password: 'bishop123', className: '', areaId: area1, createdAt: nowStr() },
    ],
    areas: [
      { id: area1, name: 'Area Alpha', bishopName: 'Bishop Esther', createdAt: nowStr() },
      { id: area2, name: 'Area Beta', bishopName: 'Bishop Samuel', createdAt: nowStr() },
    ],
    members: [
      {
        id: member1,
        fullName: 'Grace Ukpong',
        address: '21 Peace Street',
        phone: '08030000001',
        birthday: `${thisYear}-12-25`,
        areaId: area1,
        g12PastorId: g12Id,
        createdAt: nowStr(),
        createdByUserId: adminId,
      },
      {
        id: member2,
        fullName: 'Michael James',
        address: '4 Hope Avenue',
        phone: '08030000002',
        birthday: `${thisYear}-01-10`,
        areaId: '',
        g12PastorId: '',
        createdAt: nowStr(),
        createdByUserId: bishopId,
      },
    ],
    prospects: [
      {
        id: prospect1,
        fullName: 'Sandra Peter',
        phone: '08030000003',
        address: '8 Unity Close',
        birthday: `${thisYear}-08-14`,
        areaId: area2,
        createdAt: nowStr(),
      }
    ],
    serviceTemplates: defaultServiceTemplates(),
    serviceEvents: [
      { id: event1, name: 'Sunday 1st Service', category: 'Sunday', date: nextSunday, custom: false, templateId: 'tmpl_sun_1', isDefaultSeed: true, createdByUserId: adminId, createdAt: nowStr() },
      { id: event2, name: 'Sunday 2nd Service', category: 'Sunday', date: nextSunday, custom: false, templateId: 'tmpl_sun_2', isDefaultSeed: true, createdByUserId: adminId, createdAt: nowStr() },
      { id: event3, name: 'Sunday 3rd Service', category: 'Sunday', date: nextSunday, custom: false, templateId: 'tmpl_sun_3', isDefaultSeed: true, createdByUserId: adminId, createdAt: nowStr() },
      { id: event4, name: 'Sunday 4th Service', category: 'Sunday', date: nextSunday, custom: false, templateId: 'tmpl_sun_4', isDefaultSeed: true, createdByUserId: adminId, createdAt: nowStr() },
      { id: event5, name: 'Midweek Service', category: 'Midweek', date: nextWednesday, custom: false, templateId: 'tmpl_midweek', isDefaultSeed: true, createdByUserId: adminId, createdAt: nowStr() },
    ],
    attendance: [
      { id: uid('att'), eventId: event1, memberId: member1, markedByUserId: adminId, createdAt: nowStr() },
      { id: uid('att'), eventId: event1, memberId: member2, markedByUserId: adminId, createdAt: nowStr() },
      { id: uid('att'), eventId: event2, memberId: member1, markedByUserId: adminId, createdAt: nowStr() },
    ],
    messageRules: [
      {
        id: uid('rule'),
        title: 'Birthday Blessing',
        type: 'birthday',
        audienceType: 'birthdays_today',
        message: 'Happy Birthday from Refiners City International Church. We celebrate you and pray for a blessed new year.',
        scheduleDate: '',
        yearly: true,
        createdAt: nowStr(),
      },
      {
        id: uid('rule'),
        title: 'Christmas Greeting',
        type: 'holiday',
        audienceType: 'everyone',
        message: 'Merry Christmas from Refiners City International Church. Jesus is Lord.',
        scheduleDate: `${thisYear}-12-25`,
        yearly: true,
        createdAt: nowStr(),
      }
    ],
    automationLog: [],
    session: null,
  };
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db));
}

function showNotice(message, type = 'success') {
  state.notice = { id: nowStr() + Math.random().toString(36).slice(2, 6), message, type };
}

function clearNotice() {
  state.notice = null;
}

function openDialog({ title = 'Notice', message = '', tone = 'info', confirmLabel = 'OK', cancelLabel = '', onConfirm = null, onCancel = null } = {}) {
  state.dialog = { title, message, tone, confirmLabel, cancelLabel, onConfirm, onCancel };
  render();
}

function closeDialog() {
  state.dialog = null;
}

function setSession(userId) {
  state.db.session = userId;
  saveDb();
  state.session = getCurrentUser();
}

function clearSession() {
  state.db.session = null;
  saveDb();
  state.session = null;
}

function getCurrentUser() {
  return state.db.users.find(u => u.id === state.db.session) || null;
}

function getArea(areaId) {
  return state.db.areas.find(a => a.id === areaId) || null;
}

function getMember(memberId) {
  return state.db.members.find(m => m.id === memberId) || null;
}

function getUser(userId) {
  return state.db.users.find(u => u.id === userId) || null;
}

function getServiceTemplates() {
  return (state.db.serviceTemplates || [])
    .slice()
    .sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999) || (a.label || '').localeCompare(b.label || ''));
}

function getServiceTemplate(templateId) {
  return (state.db.serviceTemplates || []).find(t => t.id === templateId) || null;
}

function getWeekdayName(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
}

function buildServiceEventName(template, customTitle, customName) {
  if (!template || template === 'custom') return customName;
  return customTitle ? `${customTitle} (${template.label})` : template.label;
}

function getFilteredMembersForView({ members, search = '', areaId = '', g12Id = '', level = '', from = '', to = '', memberTab = state.memberTab, growthFocus = state.growthFocus }) {
  return members.filter(member => {
    const dateOnly = (member.createdAt || '').slice(0, 10);
    const memberLevel = getMemberLevel(member.id);
    const tabMatch = memberTab === 'members'
      || (memberTab === 'new' && memberLevel === LEVELS.new)
      || (memberTab === 'consistent' && memberLevel === LEVELS.consistent)
      || (memberTab === 'strong' && memberLevel === LEVELS.strong);
    const fromMatch = !from || dateOnly >= from;
    const toMatch = !to || dateOnly <= to;
    const searchMatch = !search || member.fullName.toLowerCase().includes(search) || member.phone.toLowerCase().includes(search);
    const levelMatch = !level || memberLevel === level;
    const areaMatch = !areaId || member.areaId === areaId;
    const g12Match = !g12Id || member.g12PastorId === g12Id;
    const growthMatch = growthFocus === 'members' || (growthFocus === 'new' && memberLevel === LEVELS.new) || (growthFocus === 'consistent' && memberLevel === LEVELS.consistent) || (growthFocus === 'strong' && memberLevel === LEVELS.strong);
    return tabMatch && fromMatch && toMatch && searchMatch && levelMatch && areaMatch && g12Match && growthMatch;
  });
}

function getAbsenteesForEvent(eventId, filters = state.absenceFilters) {
  const attendees = new Set(state.db.attendance.filter(a => a.eventId === eventId).map(a => a.memberId));
  let members = state.db.members.slice();
  if (filters.areaId) members = members.filter(member => member.areaId === filters.areaId);
  if (filters.g12Id) members = members.filter(member => member.g12PastorId === filters.g12Id);
  if (filters.level) members = members.filter(member => getMemberLevel(member.id) === filters.level);
  return members.filter(member => !attendees.has(member.id)).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

function getMembersForUser(user) {
  if (!user) return [];
  if (user.role === 'bishop') return state.db.members.filter(m => m.areaId === user.areaId);
  return state.db.members;
}

function canManageG12Class(user, pastorId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.role === 'g12' && user.id === pastorId;
}

function getSelectedG12Pastor(user = state.session) {
  const pastors = state.db.users.filter(u => u.role === 'g12').slice().sort((a, b) => (a.className || a.name).localeCompare(b.className || b.name));
  if (!pastors.length) return null;
  if (user?.role === 'g12') return pastors.find(p => p.id === user.id) || pastors[0];
  if (!state.g12FocusId) return null;
  return pastors.find(p => p.id === state.g12FocusId) || null;
}

function getAttendanceCount(memberId) {
  return state.db.attendance.filter(a => a.memberId === memberId).length;
}

function getLevelFromCount(count) {
  if (count >= 16) return LEVELS.strong;
  if (count >= 8) return LEVELS.consistent;
  return LEVELS.new;
}

function getMemberLevel(memberId) {
  return getLevelFromCount(getAttendanceCount(memberId));
}

function getMemberProfile(member) {
  const area = getArea(member.areaId);
  const pastor = getUser(member.g12PastorId);
  return {
    ...member,
    areaName: area?.name || 'Not assigned',
    g12Class: pastor?.className || 'Not assigned',
    level: getMemberLevel(member.id),
    attendanceCount: getAttendanceCount(member.id),
  };
}

function getBirthdaysToday(type = 'members') {
  const source = type === 'prospects' ? state.db.prospects : state.db.members;
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return source.filter(item => (item.birthday || '').slice(5) === `${mm}-${dd}`);
}

function getDashboardStats(user) {
  const members = getMembersForUser(user);
  const prospects = user.role === 'bishop'
    ? state.db.prospects.filter(p => p.areaId === user.areaId)
    : state.db.prospects;
  const attendanceToday = state.db.attendance.filter(a => {
    const event = state.db.serviceEvents.find(e => e.id === a.eventId);
    return event?.date === todayStr() && members.some(m => m.id === a.memberId);
  }).length;

  return {
    members: members.length,
    areas: state.db.areas.length,
    prospects: prospects.length,
    attendanceToday,
  };
}

function getPastorServiceSummary(user) {
  return state.db.serviceEvents
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8)
    .map(event => {
      const attendance = state.db.attendance.filter(a => a.eventId === event.id);
      const total = attendance.length;
      const own = user.role === 'g12'
        ? attendance.filter(a => getMember(a.memberId)?.g12PastorId === user.id).length
        : user.role === 'bishop'
          ? attendance.filter(a => getMember(a.memberId)?.areaId === user.areaId).length
          : total;
      return { event, total, own };
    });
}

function getAudienceOptions() {
  const g12Pastors = state.db.users.filter(u => u.role === 'g12');
  return {
    areas: state.db.areas,
    pastors: g12Pastors,
    members: state.db.members,
    prospects: state.db.prospects,
  };
}

function computeEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDueAutomations() {
  const today = todayStr();
  const todayMonthDay = today.slice(5);
  return state.db.messageRules.filter(rule => {
    if (rule.type === 'birthday') {
      const list = getAudience(rule).filter(item => (item.birthday || '').slice(5) === todayMonthDay);
      if (!list.length) return false;
      const token = `${rule.id}_${today}`;
      return !state.db.automationLog.includes(token);
    }
    if (rule.type === 'holiday') {
      let targetDate = rule.scheduleDate;
      if ((rule.title || '').toLowerCase().includes('easter')) {
        targetDate = computeEasterDate(new Date().getFullYear());
      } else if (rule.yearly && rule.scheduleDate) {
        targetDate = `${new Date().getFullYear()}-${rule.scheduleDate.slice(5)}`;
      }
      const token = `${rule.id}_${today}`;
      return targetDate === today && !state.db.automationLog.includes(token);
    }
    if (rule.type === 'scheduled') {
      const token = `${rule.id}_${today}`;
      if (rule.yearly && rule.scheduleDate) {
        return `${new Date().getFullYear()}-${rule.scheduleDate.slice(5)}` === today && !state.db.automationLog.includes(token);
      }
      return rule.scheduleDate === today && !state.db.automationLog.includes(token);
    }
    return false;
  });
}

function markAutomationSent(ruleId) {
  const token = `${ruleId}_${todayStr()}`;
  if (!state.db.automationLog.includes(token)) {
    state.db.automationLog.push(token);
    saveDb();
  }
}

function getAudience(ruleLike) {
  const audienceType = ruleLike.audienceType;
  const audienceId = ruleLike.audienceId;
  if (audienceType === 'everyone') return state.db.members;
  if (audienceType === 'all_prospects') return state.db.prospects;
  if (audienceType === 'birthdays_today') return getBirthdaysToday('members');
  if (audienceType === 'area') return state.db.members.filter(m => m.areaId === audienceId);
  if (audienceType === 'g12') return state.db.members.filter(m => m.g12PastorId === audienceId);
  if (audienceType === 'single_member') return state.db.members.filter(m => m.id === audienceId);
  if (audienceType === 'single_prospect') return state.db.prospects.filter(p => p.id === audienceId);
  if (audienceType === 'selected_members') return state.db.members.filter(m => (ruleLike.selectedIds || []).includes(m.id));
  if (audienceType === 'selected_prospects') return state.db.prospects.filter(p => (ruleLike.selectedIds || []).includes(p.id));
  return [];
}

function getMessageTargets({ audienceType, audienceId, selectedIds }) {
  return getAudience({ audienceType, audienceId, selectedIds });
}

function openWhatsappForTargets(targets, message) {
  const valid = targets.filter(t => phoneDigits(t.phone));
  if (!valid.length) {
    showNotice('No valid phone numbers found for this audience.', 'error');
    render();
    return;
  }
  valid.forEach((target, index) => {
    setTimeout(() => {
      window.open(whatsappUrl(target.phone, personaliseMessage(message, target)), '_blank');
    }, index * 250);
  });
}

function personaliseMessage(message, target) {
  return message.replaceAll('{name}', target.fullName || target.name || 'Member');
}

function render() {
  state.session = getCurrentUser();
  if (!state.session) {
    renderAuth();
  } else {
    renderApp();
  }
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <img src="assets/logo.jpg" alt="Refiners City logo" />
          <h2>Refiners City International Church</h2>
          <p>Attendance, membership growth, area structure, G12 tracking, follow-up lists, birthdays, and WhatsApp outreach in one place.</p>
          <div class="notice success-box">
            <strong>Demo login details</strong><br />
            Admin: admin@refiners.local / admin123<br />
            Ordained: ordained@refiners.local / pastor123<br />
            G12: g12@refiners.local / g12pass<br />
            Bishop: bishop@refiners.local / bishop123
          </div>
        </div>
        <div class="auth-form">
          <h1 class="auth-title">Welcome back</h1>
          ${state.notice ? `<div class="notice ${state.notice.type === 'success' ? 'success-box' : ''}">${escapeHtml(state.notice.message)}</div>` : ''}
          <p class="auth-subtitle">Sign in to continue, or create a pastor / bishop account. Church Admin remains the only role that can mark attendance.</p>

          <div class="tabs">
            <button class="active" data-auth-tab="login">Login</button>
            <button data-auth-tab="signup">Create account</button>
          </div>

          <div data-auth-panel="login">
            <form id="loginForm" class="form-grid single">
              <div class="field">
                <label>Email</label>
                <input type="email" name="email" placeholder="Enter email" required />
              </div>
              <div class="field">
                <label>Password</label>
                <input type="password" name="password" placeholder="Enter password" required />
              </div>
              <button class="btn" type="submit">Login</button>
            </form>
          </div>

          <div data-auth-panel="signup" class="hidden">
            <form id="signupForm" class="form-grid">
              <div class="field">
                <label>Full Name</label>
                <input name="name" required />
              </div>
              <div class="field">
                <label>Email</label>
                <input type="email" name="email" required />
              </div>
              <div class="field">
                <label>Password</label>
                <input type="password" name="password" required />
              </div>
              <div class="field">
                <label>Role</label>
                <select name="role" required>
                  <option value="ordained">Ordained Pastor</option>
                  <option value="g12">G12 Pastor</option>
                  <option value="bishop">Bishop</option>
                </select>
              </div>
              <div class="field hidden" data-signup-class-field>
                <label>G12 Class Name</label>
                <input name="className" placeholder="Example: Pastor Toby's Class" />
              </div>
              <div class="field hidden" data-signup-area-field>
                <label>Select Area</label>
                <select name="areaId">
                  <option value="">Choose area</option>
                  ${state.db.areas.map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`).join('')}
                </select>
              </div>
              <div class="inline-actions" style="grid-column:1/-1;">
                <button class="btn" type="submit">Create account</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  const tabButtons = qq('[data-auth-tab]');
  const panels = qq('[data-auth-panel]');
  tabButtons.forEach(btn => btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.toggle('active', b === btn));
    panels.forEach(panel => panel.classList.toggle('hidden', panel.dataset.authPanel !== btn.dataset.authTab));
  }));

  q('#loginForm').addEventListener('submit', handleLogin);
  const signupForm = q('#signupForm');
  signupForm.addEventListener('submit', handleSignup);
  signupForm.role.addEventListener('change', syncSignupVisibility);
  syncSignupVisibility();
}

function syncSignupVisibility() {
  const form = q('#signupForm');
  if (!form) return;
  const role = form.role.value;
  q('[data-signup-class-field]').classList.toggle('hidden', role !== 'g12');
  q('[data-signup-area-field]').classList.toggle('hidden', role !== 'bishop');
}

function handleLogin(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const email = String(fd.get('email')).trim().toLowerCase();
  const password = String(fd.get('password'));
  const user = state.db.users.find(u => u.email.toLowerCase() === email && u.password === password);
  if (!user) {
    showNotice('Invalid email or password.', 'error');
    renderAuth();
    return;
  }
  clearNotice();
  setSession(user.id);
  state.view = 'dashboard';
  render();
}

function handleSignup(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const role = String(fd.get('role'));
  const email = String(fd.get('email')).trim().toLowerCase();
  if (state.db.users.some(u => u.email.toLowerCase() === email)) {
    showNotice('That email already exists.', 'error');
    renderAuth();
    return;
  }

  let areaId = String(fd.get('areaId') || '');
  let className = String(fd.get('className') || '').trim();

  if (role === 'g12' && !className) {
    showNotice('G12 pastors must enter their class name.', 'error');
    renderAuth();
    return;
  }
  if (role === 'bishop' && !areaId) {
    showNotice('Bishops must choose an area.', 'error');
    renderAuth();
    return;
  }

  const newUser = {
    id: uid('user'),
    name: String(fd.get('name')).trim(),
    email,
    password: String(fd.get('password')),
    role,
    className,
    areaId,
    createdAt: nowStr(),
  };
  state.db.users.push(newUser);
  saveDb();
  clearNotice();
  setSession(newUser.id);
  state.view = 'dashboard';
  render();
}

function renderApp() {
  const user = state.session;
  const pageContent = renderView();
  app.innerHTML = `
    <div class="app-shell layout">
      <aside class="sidebar ${state.mobileNavOpen ? 'open' : ''}">
        <div class="brand">
          <img src="assets/logo.jpg" alt="logo" />
          <div class="brand-text">
            <h1>Refiners City</h1>
            <p>Attendance & Growth App</p>
          </div>
        </div>

        <div class="user-chip">
          <h3>${escapeHtml(user.name)}</h3>
          <p>${ROLE_LABELS[user.role]}${user.role === 'g12' && user.className ? ` • ${escapeHtml(user.className)}` : ''}${user.role === 'bishop' && getArea(user.areaId) ? ` • ${escapeHtml(getArea(user.areaId).name)}` : ''}</p>
        </div>

        <div class="nav">
          ${navButton('dashboard', 'Dashboard')}
          ${navButton('members', 'Members')}
          ${navButton('areas', 'Areas')}
          ${navButton('g12', 'G12 Groups')}
          ${navButton('attendance', 'Attendance')}
          ${navButton('messages', 'WhatsApp Centre')}
          ${navButton('prospects', 'Non Members')}
          ${navButton('birthdays', 'Birthdays Today')}
          ${navButton('automation', 'Automation Rules')}
        </div>

        <div class="sidebar-footer">
          <button class="btn secondary" data-action="check-automation">Run due automations</button>
          <button class="btn" data-action="logout">Logout</button>
        </div>
      </aside>

      <main class="main">
        <div class="topbar">
          <div>
            <button class="mobile-nav-toggle" data-action="toggle-nav">☰</button>
            <h2 class="page-title">${getViewTitle()}</h2>
            <p class="page-subtitle">${getViewSubtitle(user)}</p>
          </div>
          <div class="inline-actions">
            <span class="badge neutral">${ROLE_LABELS[user.role]}</span>
            ${getDueAutomations().length ? `<span class="badge warn">${getDueAutomations().length} due automation${getDueAutomations().length > 1 ? 's' : ''}</span>` : ''}
            <button class="btn secondary tiny topbar-logout" data-action="logout">Logout</button>
          </div>
        </div>
        ${state.notice ? `<div class="app-notice ${state.notice.type === 'success' ? 'success-box' : ''}"><span>${escapeHtml(state.notice.message)}</span></div>` : ''}
        ${pageContent}
      </main>
    </div>

    <div id="memberModal" class="modal-backdrop ${state.modalMemberId ? 'show' : ''}">
      <div class="modal">${renderMemberModal()}</div>
    </div>

    <div id="areaEditorModal" class="modal-backdrop ${(state.editingAreaId || state.removingAreaId) ? 'show' : ''}">
      <div class="modal">${renderAreaEditorModal()}</div>
    </div>

    <div id="appDialogModal" class="modal-backdrop ${state.dialog ? 'show' : ''}">
      <div class="modal dialog-modal">${renderDialogModal()}</div>
    </div>
  `;

  bindAppEvents();
}

function renderDialogModal() {
  if (!state.dialog) return '';
  const toneClass = state.dialog.tone === 'success' ? 'success-box' : state.dialog.tone === 'danger' ? 'danger-box' : '';
  return `
    <div class="modal-header">
      <div>
        <h3>${escapeHtml(state.dialog.title)}</h3>
      </div>
      <button class="btn tiny secondary" type="button" data-dialog-close>Close</button>
    </div>
    <div class="modal-body">
      <div class="notice ${toneClass}">${state.dialog.message}</div>
      <div class="inline-actions modal-actions">
        ${state.dialog.cancelLabel ? `<button class="btn tiny secondary" type="button" data-dialog-cancel>${escapeHtml(state.dialog.cancelLabel)}</button>` : ''}
        <button class="btn tiny" type="button" data-dialog-confirm>${escapeHtml(state.dialog.confirmLabel || 'OK')}</button>
      </div>
    </div>
  `;
}

function navButton(view, label) {
  return `<button class="${state.view === view ? 'active' : ''}" data-nav="${view}">${label}</button>`;
}

function getViewTitle() {
  const map = {
    dashboard: 'Dashboard',
    members: 'Members Database',
    areas: 'Areas & Administration',
    g12: 'G12 Groups',
    attendance: 'Attendance Control',
    messages: 'WhatsApp Centre',
    prospects: 'Non Members',
    birthdays: 'Birthdays Today',
    automation: 'Automation Rules',
  };
  return map[state.view] || 'Dashboard';
}

function getViewSubtitle(user) {
  if (state.view === 'attendance' && user.role !== 'admin') return 'Church Admin alone can mark attendance. Other roles can only review results.';
  if (state.view === 'areas') return 'Create church areas, assign bishops, and connect members to their administrative base.';
  if (state.view === 'g12') return "Review G12 groups, track members under each class, and zoom into a pastor's group.";
  if (state.view === 'messages') return 'Prepare manual, scheduled, holiday, and birthday WhatsApp messages for one person or many groups.';
  return 'Manage membership growth, follow-up, services, and communication from one responsive app.';
}

function renderView() {
  switch (state.view) {
    case 'dashboard': return renderDashboard();
    case 'members': return renderMembers();
    case 'areas': return renderAreas();
    case 'g12': return renderG12Groups();
    case 'attendance': return renderAttendance();
    case 'messages': return renderMessages();
    case 'prospects': return renderProspects();
    case 'birthdays': return renderBirthdays();
    case 'automation': return renderAutomation();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const user = state.session;
  const stats = getDashboardStats(user);
  const summary = getPastorServiceSummary(user);
  const visibleMembers = getMembersForUser(user);
  const newMembers = visibleMembers.filter(m => getMemberLevel(m.id) === LEVELS.new).length;
  const consistent = visibleMembers.filter(m => getMemberLevel(m.id) === LEVELS.consistent).length;
  const strong = visibleMembers.filter(m => getMemberLevel(m.id) === LEVELS.strong).length;
  const due = getDueAutomations();

  return `
    <section class="metrics">
      <div class="metric"><span>Total Members</span><strong>${stats.members}</strong></div>
      <div class="metric"><span>Attendance Today</span><strong>${stats.attendanceToday}</strong></div>
      <div class="metric"><span>Areas</span><strong>${stats.areas}</strong></div>
      <div class="metric"><span>Prospects</span><strong>${stats.prospects}</strong></div>
    </section>

    <section class="two-col">
      <div class="card">
        <h3>Growth Ladder</h3>
        <div class="stat-list">
          <div class="stat-row"><span><button class="link-btn" type="button" data-open-growth="new">New Members</button></span><strong>${newMembers}</strong></div>
          <div class="stat-row"><span><button class="link-btn" type="button" data-open-growth="consistent">Consistent New Timers</button></span><strong>${consistent}</strong></div>
          <div class="stat-row"><span><button class="link-btn" type="button" data-open-growth="strong">Strong Members</button></span><strong>${strong}</strong></div>
        </div>
        <p class="footer-note">Promotion logic: every 8 attended service events advances the member to the next level.</p>
      </div>
      <div class="card">
        <h3>Due Automation</h3>
        ${due.length ? due.map(rule => `
          <div class="member-item">
            <div>
              <strong>${escapeHtml(rule.title)}</strong>
              <div class="member-meta">Audience: ${escapeHtml(rule.audienceType.replaceAll('_', ' '))}</div>
            </div>
            <button class="btn tiny" data-run-rule="${rule.id}">Send now</button>
          </div>
        `).join('') : `<div class="empty">No automation is due right now.</div>`}
      </div>
    </section>

    <section class="two-col">
      <div class="card">
        <h3>Service Summary</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Service</th>
                <th>Total Attendance</th>
                <th>${user.role === 'g12' ? 'My G12' : user.role === 'bishop' ? 'My Area' : 'Visible'}</th>
              </tr>
            </thead>
            <tbody>
              ${summary.length ? summary.map(row => `
                <tr>
                  <td>${fmtDate(row.event.date)}</td>
                  <td>${escapeHtml(row.event.name)}</td>
                  <td>${row.total}</td>
                  <td>${row.own}</td>
                </tr>
              `).join('') : `<tr><td colspan="4">No service records yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h3>Birthdays Today</h3>
        ${getBirthdaysToday().length ? getBirthdaysToday().map(item => `
          <div class="member-item">
            <div>
              <strong>${escapeHtml(item.fullName)}</strong>
              <div class="member-meta">${escapeHtml(item.phone)} • ${escapeHtml(getArea(item.areaId)?.name || 'No area')}</div>
            </div>
            <button class="btn tiny" data-message-single-member="${item.id}">Message</button>
          </div>
        `).join('') : `<div class="empty">No member birthdays today.</div>`}
      </div>
    </section>
  `;
}

function renderMembers() {
  const user = state.session;
  const visibleMembers = getMembersForUser(user).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const areaOptions = state.db.areas;
  const g12Pastors = state.db.users.filter(u => u.role === 'g12');
  const canAdd = ['admin', 'bishop'].includes(user.role);
  const focusedArea = getArea(state.areaFocusId);
  const focusedG12 = getUser(state.g12FocusId);
  const focusedGrowth = state.growthFocus;

  const listHtml = visibleMembers.map(member => {
    const profile = getMemberProfile(member);
    return `
      <tr>
        <td><button class="link-btn" data-open-member="${member.id}">${escapeHtml(member.fullName)}</button></td>
        <td>${escapeHtml(profile.areaName)}</td>
        <td>${escapeHtml(profile.g12Class)}</td>
        <td><span class="badge ${profile.level === LEVELS.strong ? 'success' : profile.level === LEVELS.consistent ? 'warn' : ''}">${escapeHtml(profile.level)}</span></td>
        <td>${profile.attendanceCount}</td>
        <td>${fmtDate(member.createdAt)}</td>
        <td>${escapeHtml(member.phone)}</td>
      </tr>
    `;
  }).join('');

  return `
    <section class="two-col">
      <div class="card">
        <h3>${canAdd ? 'Add Member' : 'Member Filters'}</h3>
        ${canAdd ? `
          <form id="memberForm" class="form-grid">
            <div class="field"><label>Full Name</label><input name="fullName" required /></div>
            <div class="field"><label>Phone Number</label><input name="phone" required /></div>
            <div class="field" style="grid-column:1/-1;"><label>Address</label><input name="address" required /></div>
            <div class="field"><label>Birthday</label><input type="date" name="birthday" /></div>
            ${user.role === 'admin' ? `
              <div class="field"><label>Area (optional)</label><select name="areaId"><option value="">No area yet</option>${areaOptions.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
            ` : `
              <div class="field"><label>Area</label><input value="${escapeHtml(getArea(user.areaId)?.name || '')}" disabled /></div>
            `}
            <div class="inline-actions" style="grid-column:1/-1;"><button class="btn" type="submit">Save Member</button></div>
          </form>
        ` : `
          <div class="notice">Ordained pastors and G12 pastors cannot add members directly. G12 pastors can still assign members to their class below.</div>
        `}
      </div>
      <div class="card">
        <h3>Filter Members</h3>
        <div class="toolbar">
          <div class="field"><label>Added From</label><input id="memberDateFrom" type="date" /></div>
          <div class="field"><label>Added To</label><input id="memberDateTo" type="date" /></div>
          <div class="field"><label>Search Name</label><input id="memberSearch" placeholder="Search members" /></div>
          <div class="field"><label>Level</label>
            <select id="memberLevelFilter">
              <option value="">All levels</option>
              <option value="${LEVELS.new}">${LEVELS.new}</option>
              <option value="${LEVELS.consistent}">${LEVELS.consistent}</option>
              <option value="${LEVELS.strong}">${LEVELS.strong}</option>
            </select>
          </div>
        </div>
        ${focusedArea || focusedG12 || (focusedGrowth && focusedGrowth !== 'members') ? `<div class="notice area-focus-banner">${focusedArea ? `Showing members in <strong>${escapeHtml(focusedArea.name)}</strong>.` : ''} ${focusedG12 ? `Showing members in <strong>${escapeHtml(focusedG12.className || focusedG12.name)}</strong>.` : ''} ${focusedGrowth && focusedGrowth !== 'members' ? `Showing <strong>${escapeHtml(focusedGrowth === 'new' ? 'New Members' : focusedGrowth === 'consistent' ? 'Consistent New Timers' : 'Strong Members')}</strong>.` : ''} <button class="link-btn" type="button" data-clear-member-focus>Clear filter</button></div>` : ''}
        <div class="footer-note">Use date range to follow up on members added within a particular period.</div>
      </div>
    </section>

    <section class="card">
      <div class="tabs">
        ${['members','new','consistent','strong'].map(tab => `<button class="${state.memberTab===tab?'active':''}" data-member-tab="${tab}">${tab === 'members' ? 'All Members' : tab === 'new' ? 'New Members' : tab === 'consistent' ? 'Consistent New Timers' : 'Strong Members'}</button>`).join('')}
      </div>
      <div class="table-wrap">
        <table id="membersTable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Area</th>
              <th>G12 Class</th>
              <th>Level</th>
              <th>Attendance</th>
              <th>Added</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>${listHtml || `<tr><td colspan="7">No members found.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="inline-actions section-gap-top">
        <button class="btn secondary tiny" type="button" data-show-more-members>Show More</button>
        <button class="btn secondary tiny" type="button" data-show-less-members>Show Less</button>
      </div>
    </section>
  `;
}

function renderAreas() {
  const user = state.session;
  const canManage = user.role === 'admin';
  const areas = state.db.areas.slice().sort((a, b) => a.name.localeCompare(b.name));
  const visibleAreas = areas.slice(0, state.areaPageCount);
  const canShowMoreAreas = state.areaPageCount < areas.length;
  const canShowLessAreas = areas.length > 10 && state.areaPageCount > 10;
  return `
    <section class="two-col top-align">
      <div class="card">
        <h3>${canManage ? 'Create Area' : 'Area Overview'}</h3>
        ${canManage ? `
          <form id="areaForm" class="form-grid single">
            <div class="field"><label>Area Name</label><input name="name" required /></div>
            <div class="field"><label>Bishop Name</label><input name="bishopName" required /></div>
            <button class="btn" type="submit">Add Area</button>
          </form>
        ` : `<div class="notice">Only Church Admin can create areas. Bishops and pastors can review them here.</div>`}
      </div>
      <div class="card area-performance-card">
        <h3>Area Performance</h3>
        <div class="stat-list">
          ${areas.map(area => {
            const count = state.db.members.filter(m => m.areaId === area.id).length;
            return `<div class="stat-row"><span><button class="link-btn" type="button" data-open-area-members="${area.id}">${escapeHtml(area.name)}</button></span><strong>${count} members</strong></div>`;
          }).join('') || `<div class="empty">No areas yet.</div>`}
        </div>
      </div>
    </section>

    <section class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Area</th><th>Bishop</th><th>Members</th><th>Created</th>${canManage ? '<th>Actions</th>' : ''}</tr>
          </thead>
          <tbody>
            ${visibleAreas.length ? visibleAreas.map(area => `
              <tr>
                <td><button class="link-btn" type="button" data-open-area-members="${area.id}">${escapeHtml(area.name)}</button></td>
                <td>${escapeHtml(area.bishopName)}</td>
                <td>${state.db.members.filter(m => m.areaId === area.id).length}</td>
                <td>${fmtDate(area.createdAt)}</td>
                ${canManage ? `<td><div class="inline-actions"><button class="btn tiny secondary" type="button" data-edit-area="${area.id}">Edit</button><button class="btn tiny danger" type="button" data-remove-area="${area.id}">Remove</button></div></td>` : ''}
              </tr>
            `).join('') : `<tr><td colspan="${canManage ? '5' : '4'}">No areas added yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${areas.length > 10 ? `<div class="inline-actions area-list-controls">${canShowMoreAreas ? `<button class="btn tiny secondary" type="button" data-show-more-areas>Show More</button>` : ''}${canShowLessAreas ? `<button class="btn tiny secondary" type="button" data-show-less-areas>Show Less</button>` : ''}</div>` : ''}
    </section>
  `;
}

function renderG12Groups() {
  const user = state.session;
  const pastors = state.db.users.filter(u => u.role === 'g12').slice().sort((a, b) => (a.className || a.name).localeCompare(b.className || b.name));
  const selectedPastor = getSelectedG12Pastor(user);
  const selectedMembers = selectedPastor ? state.db.members.filter(m => m.g12PastorId === selectedPastor.id).slice().sort((a, b) => a.fullName.localeCompare(b.fullName)) : [];
  const canManageSelected = selectedPastor ? canManageG12Class(user, selectedPastor.id) : false;
  const availableMembers = state.db.members.slice().sort((a, b) => a.fullName.localeCompare(b.fullName));

  return `
    <section class="two-col top-align">
      <div class="card">
        <h3>${user.role === 'g12' ? 'My G12 Group' : 'Create / Review G12 Classes'}</h3>
        ${user.role === 'admin' ? `
          <form id="createG12ClassForm" class="form-grid">
            <div class="field">
              <label>Pastor Name</label>
              <input name="name" placeholder="Example: Pastor Mary" required />
            </div>
            <div class="field">
              <label>Class Name</label>
              <input name="className" placeholder="Example: Pastor Mary's Class" required />
            </div>
            <div class="field">
              <label>Email</label>
              <input type="email" name="email" placeholder="pastor@refiners.local" required />
            </div>
            <div class="field">
              <label>Password</label>
              <input type="text" name="password" placeholder="Create password" required />
            </div>
            <div class="inline-actions" style="grid-column:1/-1;">
              <button class="btn" type="submit">Add G12 Class</button>
            </div>
          </form>
        ` : `<div class="notice">Open a G12 class below to review the members already assigned to that class.</div>`}

        <div class="stat-list section-gap-top">
          ${pastors.length ? pastors.map(pastor => {
            const count = state.db.members.filter(m => m.g12PastorId === pastor.id).length;
            return `<div class="stat-row"><span><button class="link-btn" type="button" data-open-g12-members="${pastor.id}">${escapeHtml(pastor.className || pastor.name)}</button></span><strong>${count} members</strong></div>`;
          }).join('') : `<div class="empty">No G12 classes yet.</div>`}
        </div>
      </div>
      <div class="card">
        <h3>${selectedPastor ? escapeHtml(selectedPastor.className || selectedPastor.name) : 'Selected G12 Class'}</h3>
        ${selectedPastor ? `
          <div class="member-meta" style="margin-bottom:14px;">Pastor: ${escapeHtml(selectedPastor.name)} • Created ${fmtDate(selectedPastor.createdAt)}</div>
          ${canManageSelected ? `
            <form id="g12ClassSettingsForm" class="form-grid">
              <input type="hidden" name="pastorId" value="${selectedPastor.id}" />
              <div class="field">
                <label>Class Name</label>
                <input name="className" value="${escapeHtml(selectedPastor.className || '')}" required />
              </div>
              <div class="field">
                <label>Add Member From General List</label>
                <select name="memberId">
                  <option value="">Choose member</option>
                  ${availableMembers.map(member => {
                    const assigned = getUser(member.g12PastorId);
                    const suffix = assigned ? ` — already in ${assigned.className || assigned.name}` : '';
                    return `<option value="${member.id}">${escapeHtml(member.fullName)}${escapeHtml(suffix)}</option>`;
                  }).join('')}
                </select>
              </div>
              <div class="inline-actions" style="grid-column:1/-1;">
                <button class="btn" type="submit">Save Class Changes</button>
              </div>
            </form>
          ` : `
            <div class="notice">This class is read-only for your role. Only Church Admin or the pastor who owns this G12 class can edit it.</div>
          `}
        ` : `<div class="empty">Select a G12 class to view or manage it.</div>`}
      </div>
    </section>

    <section class="card">
      <h3>${selectedPastor ? `Members in ${escapeHtml(selectedPastor.className || selectedPastor.name)}` : 'G12 Members'}</h3>
      ${selectedPastor ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Area</th><th>Level</th><th>Attendance</th><th>Phone</th>${canManageSelected ? '<th>Action</th>' : ''}</tr>
            </thead>
            <tbody>
              ${selectedMembers.length ? selectedMembers.map(member => {
                const profile = getMemberProfile(member);
                return `
                  <tr>
                    <td><button class="link-btn" type="button" data-open-member="${member.id}">${escapeHtml(member.fullName)}</button></td>
                    <td>${escapeHtml(profile.areaName)}</td>
                    <td><span class="badge ${profile.level === LEVELS.strong ? 'success' : profile.level === LEVELS.consistent ? 'warn' : ''}">${escapeHtml(profile.level)}</span></td>
                    <td>${profile.attendanceCount}</td>
                    <td>${escapeHtml(member.phone)}</td>
                    ${canManageSelected ? `<td><button class="btn tiny secondary" type="button" data-remove-member-from-g12="${member.id}" data-pastor-id="${selectedPastor.id}">Remove</button></td>` : ''}
                  </tr>
                `;
              }).join('') : `<tr><td colspan="${canManageSelected ? '6' : '5'}">No members assigned to this G12 class yet.</td></tr>`}
            </tbody>
          </table>
        </div>
      ` : `<div class="empty">Select a G12 class to view its members.</div>`}
    </section>
  `;
}

function renderAttendance() {
  const user = state.session;
  const events = state.db.serviceEvents.slice().sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const templates = getServiceTemplates();
  const selectedEventId = state.selectedAttendanceEventId || '';
  const selectedEvent = state.db.serviceEvents.find(e => e.id === selectedEventId);

  return `
    <section class="attendance-flow-card card">
      <div class="flow-heading">
        <div>
          <h3>1. Start a Service</h3>
          <p class="footer-note">Pick the service, choose the date from the calendar, optionally name it, then start marking attendance.</p>
        </div>
        ${selectedEvent ? `<span class="badge success">Open: ${escapeHtml(selectedEvent.name)}</span>` : `<span class="badge neutral">No service open</span>`}
      </div>
      ${user.role === 'admin' ? `
        <form id="serviceForm" class="form-grid service-start-grid">
          <div class="field"><label>Service Date</label><input type="date" name="date" value="${todayStr()}" required /></div>
          <div class="field"><label>Service Type</label>
            <select name="templateId" id="serviceTemplateSelect">
              ${templates.map(template => `<option value="${template.id}">${escapeHtml(template.label)} • ${escapeHtml(template.dayOfWeek || template.category)}</option>`).join('')}
              <option value="custom">Custom Activity / Conference</option>
              <option value="add_statutory">Add New Statutory Service Day</option>
            </select>
          </div>
          <div class="field"><label>Optional Service Name / Theme</label><input name="customTitle" placeholder="Example: Love Service, Easter Service" /></div>
          <div class="field hidden" data-custom-service-field><label>Custom Activity Name</label><input name="customName" placeholder="Example: Youth Conference" /></div>
          <div class="field hidden" data-new-statutory-field><label>New Statutory Service Name</label><input name="newStatutoryName" placeholder="Example: Friday Prayer Service" /></div>
          <div class="field hidden" data-new-statutory-field><label>Day of Week</label>
            <select name="newStatutoryDay">
              ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(day => `<option value="${day}">${day}</option>`).join('')}
            </select>
          </div>
          <div class="field hidden" data-new-statutory-field><label>Category</label>
            <select name="newStatutoryCategory"><option value="Sunday">Sunday</option><option value="Midweek">Midweek</option><option value="Statutory">Statutory</option></select>
          </div>
          <div class="inline-actions service-start-actions"><button class="btn" type="submit">Start Service & Mark Attendance</button></div>
        </form>
      ` : `<div class="notice">Attendance marking is read-only for your role. Church Admin alone can create services and tick attendance.</div>`}
    </section>

    <section class="card attendance-mark-card">
      <div id="attendanceWorkspace">
        ${selectedEventId ? renderAttendanceWorkspace(selectedEventId) : `<div class="empty attendance-empty"><strong>2. Mark Attendance</strong><span>Start a new service above. The member list, summary, and absentee follow-up will appear here.</span></div>`}
      </div>
    </section>

    <section class="card service-history-card">
      <div class="flow-heading"><div><h3>3. Service History</h3><p class="footer-note">Latest services appear first. Open any saved service by date or name to review attendance and absentees.</p></div></div>
      <div class="toolbar compact-toolbar service-history-filters">
        <div class="field"><label>Search Service Name</label><input id="serviceHistorySearch" placeholder="Love Service, Midweek, Easter..." /></div>
        <div class="field"><label>From</label><input type="date" id="serviceHistoryFrom" /></div>
        <div class="field"><label>To</label><input type="date" id="serviceHistoryTo" /></div>
      </div>
      <div class="service-history-list" id="serviceHistoryList">
        ${events.length ? events.map(event => {
          const count = state.db.attendance.filter(a => a.eventId === event.id).length;
          const active = selectedEventId === event.id;
          return `<button class="service-history-item ${active ? 'active' : ''}" type="button" data-open-service-event="${event.id}" data-service-name="${escapeHtml(event.name).toLowerCase()}" data-service-date="${event.date}"><div><strong>${escapeHtml(event.name)}</strong><span>${fmtDate(event.date)} • ${escapeHtml(event.category)} • ${escapeHtml(getWeekdayName(event.date))}</span></div><b>${count} present</b></button>`;
        }).join('') : `<div class="empty">No service has been started yet.</div>`}
      </div>
    </section>
  `;
}

function renderAttendanceWorkspace(eventId) {
  const event = state.db.serviceEvents.find(e => e.id === eventId);
  if (!event) return `<div class="empty">Choose a valid service event.</div>`;
  const user = state.session;
  const attendees = state.db.attendance.filter(a => a.eventId === eventId);
  const members = state.db.members.slice().sort((a, b) => a.fullName.localeCompare(b.fullName));
  const absentees = getAbsenteesForEvent(eventId);
  const attendanceRate = members.length ? Math.round((attendees.length / members.length) * 100) : 0;
  const pastors = state.db.users.filter(u => u.role === 'g12').slice().sort((a, b) => (a.className || a.name).localeCompare(b.className || b.name));
  return `
    <div class="active-service-header"><div><h3>${escapeHtml(event.name)}</h3><p class="page-subtitle">${fmtDate(event.date)} • ${escapeHtml(event.category)} • ${escapeHtml(getWeekdayName(event.date))}</p></div><div class="inline-actions"><button class="btn secondary tiny" type="button" data-close-attendance-service>Close & Save Service</button></div></div>
    <div class="attendance-work-grid">
      <div class="attendance-panel"><h3>Mark Present Members</h3>
        <div class="toolbar"><div class="field"><label>Search Member</label><input id="attendanceSearch" placeholder="Search member name" /></div><div class="field"><label>Filter Area</label><select id="attendanceAreaFilter"><option value="">All areas</option>${state.db.areas.map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`).join('')}</select></div></div>
        ${user.role === 'admin' ? `<details class="quick-add-box"><summary>Add a new person while marking attendance</summary><form id="attendanceQuickMemberForm" class="form-grid compact-form"><input type="hidden" name="eventId" value="${event.id}" /><div class="field"><label>Full Name</label><input name="fullName" placeholder="Member name" required /></div><div class="field"><label>Phone</label><input name="phone" placeholder="Phone number" /></div><div class="field"><label>Area</label><select name="areaId"><option value="">No area yet</option>${state.db.areas.map(area => `<option value="${area.id}">${escapeHtml(area.name)}</option>`).join('')}</select></div><div class="field" style="grid-column:1/-1;"><label>Address</label><input name="address" placeholder="Address" /></div><div class="inline-actions" style="grid-column:1/-1;"><button class="btn tiny" type="submit">Add & Mark Present</button></div></form></details>` : ''}
        <div class="checklist attendance-checklist" id="attendanceChecklist">
          ${members.map(member => { const checked = attendees.some(a => a.memberId === member.id); return `<label class="check-row" data-attendance-row data-name="${escapeHtml(member.fullName).toLowerCase()}" data-area="${member.areaId || ''}"><div><strong>${escapeHtml(member.fullName)}</strong><div class="member-meta">${escapeHtml(getArea(member.areaId)?.name || 'No area')} • ${escapeHtml(getUser(member.g12PastorId)?.className || 'No G12 class')}</div></div>${user.role === 'admin' ? `<input type="checkbox" data-attendance-member="${member.id}" data-event="${event.id}" ${checked ? 'checked' : ''} />` : `<span class="badge ${checked ? 'success' : 'neutral'}">${checked ? 'Present' : 'Absent'}</span>`}</label>`; }).join('')}
        </div>
      </div>
      <div class="attendance-panel summary-panel"><h3>Live Summary</h3><div class="stat-list"><div class="stat-row"><span>Total Registered Members</span><strong>${members.length}</strong></div><div class="stat-row"><span>Total Attendance</span><strong>${attendees.length}</strong></div><div class="stat-row"><span>Total Absentees</span><strong>${absentees.length}</strong></div><div class="stat-row"><span>Attendance Rate</span><strong>${attendanceRate}%</strong></div><div class="stat-row"><span>Attendees in a G12 Class</span><strong>${attendees.filter(a => getMember(a.memberId)?.g12PastorId).length}</strong></div><div class="stat-row"><span>Areas Represented</span><strong>${new Set(attendees.map(a => getMember(a.memberId)?.areaId).filter(Boolean)).size}</strong></div></div></div>
    </div>
    <div class="card absentees-card-inner"><h3>Absentees After Service</h3><p class="footer-note">Calculated from all registered members by default. Use filters only when you want to narrow follow-up.</p><div class="toolbar compact-toolbar"><div class="field"><label>Area</label><select id="absenceAreaFilter"><option value="">All registered members</option>${state.db.areas.map(area => `<option value="${area.id}" ${state.absenceFilters.areaId === area.id ? 'selected' : ''}>${escapeHtml(area.name)}</option>`).join('')}</select></div><div class="field"><label>G12 Class</label><select id="absenceG12Filter"><option value="">All G12 classes</option>${pastors.map(pastor => `<option value="${pastor.id}" ${state.absenceFilters.g12Id === pastor.id ? 'selected' : ''}>${escapeHtml(pastor.className || pastor.name)}</option>`).join('')}</select></div><div class="field"><label>Level</label><select id="absenceLevelFilter"><option value="">All levels</option><option value="${LEVELS.new}" ${state.absenceFilters.level === LEVELS.new ? 'selected' : ''}>${LEVELS.new}</option><option value="${LEVELS.consistent}" ${state.absenceFilters.level === LEVELS.consistent ? 'selected' : ''}>${LEVELS.consistent}</option><option value="${LEVELS.strong}" ${state.absenceFilters.level === LEVELS.strong ? 'selected' : ''}>${LEVELS.strong}</option></select></div></div><div class="inline-actions section-gap-top"><button class="btn tiny" type="button" data-message-absentees-all="${event.id}">Message All Absentees</button><button class="btn secondary tiny" type="button" data-message-absentees-selected="${event.id}">Message Selected</button></div><div class="table-wrap section-gap-top"><table><thead><tr><th></th><th>Name</th><th>Area</th><th>G12 Class</th><th>Level</th><th>Phone</th></tr></thead><tbody>${absentees.length ? absentees.map(member => { const profile = getMemberProfile(member); return `<tr><td><input type="checkbox" data-absentee-checkbox value="${member.id}" /></td><td><button class="link-btn" type="button" data-open-member="${member.id}">${escapeHtml(member.fullName)}</button></td><td>${escapeHtml(profile.areaName)}</td><td>${escapeHtml(profile.g12Class)}</td><td><span class="badge ${profile.level === LEVELS.strong ? 'success' : profile.level === LEVELS.consistent ? 'warn' : ''}">${escapeHtml(profile.level)}</span></td><td>${escapeHtml(member.phone)}</td></tr>`; }).join('') : `<tr><td colspan="6">No absentees match the current filters.</td></tr>`}</tbody></table></div></div>
  `;
}

function renderMessages() {
  const options = getAudienceOptions();
  return `
    <section class="two-col">
      <div class="card">
        <h3>Manual / Scheduled Message</h3>
        <form id="messageForm" class="form-grid">
          <div class="field">
            <label>Audience Type</label>
            <select name="audienceType" id="messageAudienceType">
              <option value="everyone">Everyone</option>
              <option value="area">Area</option>
              <option value="g12">G12 Class</option>
              <option value="single_member">One Member</option>
              <option value="selected_members">Selected Members</option>
              <option value="birthdays_today">Birthdays Today</option>
              <option value="all_prospects">All Non Members</option>
              <option value="single_prospect">One Non Member</option>
              <option value="selected_prospects">Selected Non Members</option>
            </select>
          </div>
          <div class="field hidden" data-message-area>
            <label>Choose Area</label>
            <select name="audienceId">${options.areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select>
          </div>
          <div class="field hidden" data-message-g12>
            <label>Choose G12 Class</label>
            <select name="g12Id">${options.pastors.map(p => `<option value="${p.id}">${escapeHtml(p.className || p.name)}</option>`).join('')}</select>
          </div>
          <div class="field hidden" data-message-single-member>
            <label>Choose Member</label>
            <select name="memberId">${options.members.map(m => `<option value="${m.id}">${escapeHtml(m.fullName)}</option>`).join('')}</select>
          </div>
          <div class="field hidden" data-message-single-prospect>
            <label>Choose Non Member</label>
            <select name="prospectId">${options.prospects.map(p => `<option value="${p.id}">${escapeHtml(p.fullName)}</option>`).join('')}</select>
          </div>
          <div class="field hidden" data-message-selected-members style="grid-column:1/-1;">
            <label>Select Members</label>
            <div class="checklist" style="max-height:220px;">${options.members.map(m => `<label class="check-row"><span>${escapeHtml(m.fullName)}</span><input type="checkbox" name="selectedMemberIds" value="${m.id}" /></label>`).join('')}</div>
          </div>
          <div class="field hidden" data-message-selected-prospects style="grid-column:1/-1;">
            <label>Select Non Members</label>
            <div class="checklist" style="max-height:220px;">${options.prospects.map(p => `<label class="check-row"><span>${escapeHtml(p.fullName)}</span><input type="checkbox" name="selectedProspectIds" value="${p.id}" /></label>`).join('')}</div>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label>Message</label>
            <textarea name="message" placeholder="Use {name} to personalise the message." required></textarea>
          </div>
          <div class="field"><label>Schedule Date (optional)</label><input type="date" name="scheduleDate" /></div>
          <div class="field"><label>Yearly Repeat</label>
            <select name="yearly"><option value="false">No</option><option value="true">Yes</option></select>
          </div>
          <div class="inline-actions" style="grid-column:1/-1;">
            <button class="btn" type="submit">Send Now</button>
            <button class="btn secondary" type="button" id="saveMessageRuleBtn">Save as Scheduled Rule</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h3>How WhatsApp Works Here</h3>
        <div class="notice">Because GitHub Pages is static, the app prepares and opens WhatsApp chats with the right text and audience. Scheduled and automated campaigns become due inside the app and can be sent instantly when you open it.</div>
        <div class="message-preview">Supported audiences: one person, selected names, G12 class, area, everyone, birthdays today, and all non members.</div>
      </div>
    </section>
  `;
}

function renderProspects() {
  const user = state.session;
  const areas = state.db.areas;
  const prospects = (user.role === 'bishop'
    ? state.db.prospects.filter(p => p.areaId === user.areaId)
    : state.db.prospects)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return `
    <section class="two-col">
      <div class="card">
        <h3>Add Non Member / Prospect</h3>
        <form id="prospectForm" class="form-grid">
          <div class="field"><label>Full Name</label><input name="fullName" required /></div>
          <div class="field"><label>Phone Number</label><input name="phone" required /></div>
          <div class="field" style="grid-column:1/-1;"><label>Address</label><input name="address" /></div>
          <div class="field"><label>Birthday</label><input type="date" name="birthday" /></div>
          <div class="field"><label>Area (optional)</label><select name="areaId"><option value="">No area</option>${areas.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}</select></div>
          <div class="inline-actions" style="grid-column:1/-1;"><button class="btn" type="submit">Save Prospect</button></div>
        </form>
      </div>
      <div class="card">
        <h3>Prospecting Note</h3>
        <div class="notice">This separate list is for people the church is still following up and prospecting. They can still receive manual, scheduled, holiday, and birthday WhatsApp messages.</div>
      </div>
    </section>

    <section class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Area</th><th>Phone</th><th>Birthday</th><th>Added</th><th>Message</th></tr></thead>
          <tbody>
            ${prospects.length ? prospects.map(p => `
              <tr>
                <td>${escapeHtml(p.fullName)}</td>
                <td>${escapeHtml(getArea(p.areaId)?.name || 'No area')}</td>
                <td>${escapeHtml(p.phone || '—')}</td>
                <td>${fmtDate(p.birthday)}</td>
                <td>${fmtDate(p.createdAt)}</td>
                <td><button class="btn tiny" data-message-single-prospect="${p.id}">Message</button></td>
              </tr>
            `).join('') : `<tr><td colspan="6">No non members yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderBirthdays() {
  const members = getBirthdaysToday();
  const prospects = getBirthdaysToday('prospects');
  return `
    <section class="three-col">
      <div class="card">
        <h3>Member Birthdays Today</h3>
        ${members.length ? members.map(member => `
          <div class="member-item">
            <div>
              <strong>${escapeHtml(member.fullName)}</strong>
              <div class="member-meta">${escapeHtml(member.phone)} • ${escapeHtml(getArea(member.areaId)?.name || 'No area')}</div>
            </div>
            <button class="btn tiny" data-message-single-member="${member.id}">Message</button>
          </div>
        `).join('') : `<div class="empty">No member birthdays today.</div>`}
      </div>
      <div class="card">
        <h3>Non Member Birthdays Today</h3>
        ${prospects.length ? prospects.map(person => `
          <div class="member-item">
            <div>
              <strong>${escapeHtml(person.fullName)}</strong>
              <div class="member-meta">${escapeHtml(person.phone)} • ${escapeHtml(getArea(person.areaId)?.name || 'No area')}</div>
            </div>
            <button class="btn tiny" data-message-single-prospect="${person.id}">Message</button>
          </div>
        `).join('') : `<div class="empty">No non member birthdays today.</div>`}
      </div>
      <div class="card">
        <h3>Quick Actions</h3>
        <div class="inline-actions">
          <button class="btn" data-quick-birthday="members">Message All Members</button>
          <button class="btn secondary" data-quick-birthday="prospects">Message All Non Members</button>
        </div>
        <p class="footer-note">Birthday automation rules can also send these messages when they become due.</p>
      </div>
    </section>
  `;
}

function renderAutomation() {
  const rules = state.db.messageRules.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `
    <section class="card">
      <h3>Saved Rules</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Schedule</th><th>Yearly</th><th>Action</th></tr></thead>
          <tbody>
            ${rules.length ? rules.map(rule => `
              <tr>
                <td>${escapeHtml(rule.title)}</td>
                <td>${escapeHtml(rule.type)}</td>
                <td>${escapeHtml(rule.audienceType.replaceAll('_',' '))}</td>
                <td>${rule.type === 'holiday' && rule.title.toLowerCase().includes('easter') ? 'Easter (auto-computed)' : escapeHtml(rule.scheduleDate || 'Birthday / Dynamic')}</td>
                <td>${rule.yearly ? 'Yes' : 'No'}</td>
                <td><button class="btn tiny" data-run-rule="${rule.id}">Run</button></td>
              </tr>
            `).join('') : `<tr><td colspan="6">No automation rules saved yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    <section class="two-col">
      <div class="card">
        <h3>Quick Holiday Rules</h3>
        <div class="inline-actions">
          <button class="btn" data-add-holiday="Christmas">Add Christmas Rule</button>
          <button class="btn secondary" data-add-holiday="Easter">Add Easter Rule</button>
        </div>
      </div>
      <div class="card">
        <h3>Engine Note</h3>
        <div class="notice">Birthday, holiday, and scheduled rules are stored in the app. When the app is opened, due rules can be run instantly through WhatsApp links.</div>
      </div>
    </section>
  `;
}

function renderMemberModal() {
  const member = getMember(state.modalMemberId);
  if (!member) return '';
  const profile = getMemberProfile(member);
  const user = state.session;
  const g12Pastors = state.db.users.filter(u => u.role === 'g12').slice().sort((a, b) => (a.className || a.name).localeCompare(b.className || b.name));
  const assignedPastor = getUser(member.g12PastorId);
  const canAdminManage = user.role === 'admin';
  const canSelfManage = user.role === 'g12' && (!member.g12PastorId || member.g12PastorId === user.id);

  return `
    <div class="modal-header">
      <div>
        <h3>${escapeHtml(profile.fullName)}</h3>
        <p class="page-subtitle">Member Details</p>
      </div>
      <button class="btn tiny secondary" data-close-member-modal>Close</button>
    </div>
    <div class="modal-body">
      <section class="three-col">
        <div class="metric"><span>Area</span><strong style="font-size:18px;">${escapeHtml(profile.areaName)}</strong></div>
        <div class="metric"><span>G12 Class</span><strong style="font-size:18px;">${escapeHtml(profile.g12Class)}</strong></div>
        <div class="metric"><span>Level</span><strong style="font-size:18px;">${escapeHtml(profile.level)}</strong></div>
      </section>
      <section class="card" style="margin-top:16px;">
        <div class="stat-list">
          <div class="stat-row"><span>Phone Number</span><strong>${escapeHtml(profile.phone)}</strong></div>
          <div class="stat-row"><span>Address</span><strong>${escapeHtml(profile.address)}</strong></div>
          <div class="stat-row"><span>Birthday</span><strong>${fmtDate(profile.birthday)}</strong></div>
          <div class="stat-row"><span>Attendance Count</span><strong>${profile.attendanceCount}</strong></div>
          <div class="stat-row"><span>Date Added</span><strong>${fmtDateTime(profile.createdAt)}</strong></div>
        </div>
      </section>
      <section class="card" style="margin-top:16px;">
        <h3 style="margin-bottom:12px;">G12 Assignment</h3>
        ${canAdminManage ? `
          <form id="memberG12Form" class="form-grid single">
            <input type="hidden" name="memberId" value="${member.id}" />
            <div class="field">
              <label>Choose G12 Class</label>
              <select name="g12PastorId">
                <option value="">No G12 class</option>
                ${g12Pastors.map(pastor => `<option value="${pastor.id}" ${member.g12PastorId === pastor.id ? 'selected' : ''}>${escapeHtml(pastor.className || pastor.name)}</option>`).join('')}
              </select>
            </div>
            <div class="inline-actions"><button class="btn" type="submit">Save G12 Assignment</button></div>
          </form>
        ` : canSelfManage ? `
          <form id="memberG12Form" class="form-grid single">
            <input type="hidden" name="memberId" value="${member.id}" />
            <div class="field">
              <label>My G12 Class</label>
              <select name="g12PastorId">
                <option value="">No G12 class</option>
                <option value="${user.id}" ${member.g12PastorId === user.id ? 'selected' : ''}>${escapeHtml(user.className || user.name)}</option>
              </select>
            </div>
            <div class="inline-actions"><button class="btn" type="submit">Save G12 Assignment</button></div>
          </form>
        ` : `
          <div class="notice">${assignedPastor ? `This member already belongs to <strong>${escapeHtml(assignedPastor.className || assignedPastor.name)}</strong>.` : 'Only Church Admin or the owner of a G12 class can edit the G12 assignment here.'}</div>
        `}
      </section>
    </div>
  `;
}

function renderAreaEditorModal() {
  const editingArea = state.editingAreaId ? getArea(state.editingAreaId) : null;
  const removingArea = state.removingAreaId ? getArea(state.removingAreaId) : null;
  if (!editingArea && !removingArea) return '';

  if (editingArea) {
    return `
      <div class="modal-header">
        <div>
          <h3>Edit Area</h3>
          <p class="page-subtitle">Update area details inside the app.</p>
        </div>
        <button class="btn tiny secondary" data-close-area-modal>Close</button>
      </div>
      <div class="modal-body">
        <form id="editAreaForm" class="form-grid single">
          <input type="hidden" name="areaId" value="${editingArea.id}" />
          <div class="field"><label>Area Name</label><input name="name" value="${escapeHtml(editingArea.name)}" required /></div>
          <div class="field"><label>Bishop Name</label><input name="bishopName" value="${escapeHtml(editingArea.bishopName || '')}" required /></div>
          <div class="inline-actions"><button class="btn" type="submit">Save Changes</button></div>
        </form>
      </div>
    `;
  }

  const membersCount = state.db.members.filter(m => m.areaId === removingArea.id).length;
  const prospectsCount = state.db.prospects.filter(p => p.areaId === removingArea.id).length;
  const bishopsCount = state.db.users.filter(u => u.role === 'bishop' && u.areaId === removingArea.id).length;
  return `
    <div class="modal-header">
      <div>
        <h3>Remove Area</h3>
        <p class="page-subtitle">This action will unassign linked records from the area.</p>
      </div>
      <button class="btn tiny secondary" data-close-area-modal>Close</button>
    </div>
    <div class="modal-body">
      <div class="notice">Remove <strong>${escapeHtml(removingArea.name)}</strong>? ${membersCount} member(s), ${prospectsCount} prospect(s), and ${bishopsCount} bishop account(s) will be unassigned from this area.</div>
      <div class="inline-actions" style="margin-top:14px;">
        <button class="btn danger" type="button" data-confirm-remove-area="${removingArea.id}">Remove Area</button>
        <button class="btn secondary" type="button" data-close-area-modal>Cancel</button>
      </div>
    </div>
  `;
}

function syncFlashNotice() {
  if (!state.notice || state.notice.type !== 'success') return;
  const noticeId = state.notice.id;
  window.clearTimeout(state.noticeTimer);
  state.noticeTimer = window.setTimeout(() => {
    if (state.notice && state.notice.id === noticeId) {
      clearNotice();
      render();
    }
  }, 2400);
}

function bindAppEvents() {
  syncFlashNotice();

  qq('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
    state.view = btn.dataset.nav;
    state.mobileNavOpen = false;
    render();
  }));

  qq('[data-action="logout"]').forEach(btn => btn.addEventListener('click', () => {
    clearSession();
    clearNotice();
    render();
  }));

  q('[data-action="check-automation"]')?.addEventListener('click', () => runDailyAutomationCheck(true));

  const toggleBtn = q('[data-action="toggle-nav"]');
  if (toggleBtn) toggleBtn.addEventListener('click', () => {
    state.mobileNavOpen = !state.mobileNavOpen;
    render();
  });

  q('#memberModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'memberModal') {
      state.modalMemberId = null;
      render();
    }
  });
  q('[data-close-member-modal]')?.addEventListener('click', () => {
    state.modalMemberId = null;
    render();
  });

  q('[data-clear-notice]')?.addEventListener('click', () => {
    clearNotice();
    render();
  });

  q('#areaEditorModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'areaEditorModal') {
      state.editingAreaId = null;
      state.removingAreaId = null;
      render();
    }
  });
  qq('[data-close-area-modal]').forEach(btn => btn.addEventListener('click', () => {
    state.editingAreaId = null;
    state.removingAreaId = null;
    render();
  }));
  q('#editAreaForm')?.addEventListener('submit', handleSaveAreaEdit);
  q('[data-confirm-remove-area]')?.addEventListener('click', (e) => handleRemoveAreaConfirmed(e.target.dataset.confirmRemoveArea));

  q('#appDialogModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'appDialogModal') {
      closeDialog();
      render();
    }
  });
  q('[data-dialog-close]')?.addEventListener('click', () => {
    closeDialog();
    render();
  });
  q('[data-dialog-cancel]')?.addEventListener('click', () => {
    const onCancel = state.dialog?.onCancel;
    closeDialog();
    if (onCancel) onCancel();
    render();
  });
  q('[data-dialog-confirm]')?.addEventListener('click', () => {
    const onConfirm = state.dialog?.onConfirm;
    closeDialog();
    if (onConfirm) onConfirm();
    render();
  });

  q('#memberForm')?.addEventListener('submit', handleAddMember);
  q('#areaForm')?.addEventListener('submit', handleAddArea);
  q('#createG12ClassForm')?.addEventListener('submit', handleCreateG12Class);
  q('#serviceForm')?.addEventListener('submit', handleCreateService);
  q('#prospectForm')?.addEventListener('submit', handleAddProspect);
  q('#messageForm')?.addEventListener('submit', handleSendMessageNow);
  q('#saveMessageRuleBtn')?.addEventListener('click', handleSaveMessageRule);

  qq('[data-edit-area]').forEach(btn => btn.addEventListener('click', () => handleEditArea(btn.dataset.editArea)));
  qq('[data-remove-area]').forEach(btn => btn.addEventListener('click', () => handleRemoveArea(btn.dataset.removeArea)));
  qq('[data-open-area-members]').forEach(btn => btn.addEventListener('click', () => {
    state.areaFocusId = btn.dataset.openAreaMembers;
    state.g12FocusId = '';
    state.growthFocus = 'members';
    state.memberTab = 'members';
    state.view = 'members';
    render();
  }));
  q('[data-clear-member-focus]')?.addEventListener('click', () => {
    state.areaFocusId = '';
    state.g12FocusId = '';
    state.growthFocus = 'members';
    state.memberTab = 'members';
    render();
  });
  q('[data-show-more-areas]')?.addEventListener('click', () => {
    state.areaPageCount = Math.min(state.areaPageCount + 10, state.db.areas.length);
    render();
  });
  q('[data-show-less-areas]')?.addEventListener('click', () => {
    state.areaPageCount = 10;
    render();
  });

  q('#messageAudienceType')?.addEventListener('change', syncMessageAudienceVisibility);
  syncMessageAudienceVisibility();

  q('#serviceTemplateSelect')?.addEventListener('change', (e) => {
    const isCustom = e.target.value === 'custom';
    const isNewStatutory = e.target.value === 'add_statutory';
    q('[data-custom-service-field]')?.classList.toggle('hidden', !isCustom);
    qq('[data-new-statutory-field]').forEach(field => field.classList.toggle('hidden', !isNewStatutory));
  });

  qq('[data-open-service-event]').forEach(btn => btn.addEventListener('click', () => {
    state.selectedAttendanceEventId = btn.dataset.openServiceEvent;
    render();
  }));
  q('#serviceHistorySearch')?.addEventListener('input', applyServiceHistoryFilters);
  q('#serviceHistoryFrom')?.addEventListener('change', applyServiceHistoryFilters);
  q('#serviceHistoryTo')?.addEventListener('change', applyServiceHistoryFilters);
  if (state.view === 'attendance') bindAttendanceWorkspace();

  qq('[data-open-member]').forEach(btn => btn.addEventListener('click', () => {
    state.modalMemberId = btn.dataset.openMember;
    render();
  }));

  q('#memberG12Form')?.addEventListener('submit', handleMemberModalG12Save);
  q('#g12ClassSettingsForm')?.addEventListener('submit', handleG12ClassSettingsSave);
  qq('[data-open-g12-members]').forEach(btn => btn.addEventListener('click', () => {
    const clickedId = btn.dataset.openG12Members;
    if (state.session?.role === 'admin' && state.g12FocusId === clickedId) {
      state.g12FocusId = '';
    } else {
      state.g12FocusId = clickedId;
    }
    state.areaFocusId = '';
    if (state.view !== 'g12') state.view = 'g12';
    render();
  }));
  qq('[data-remove-member-from-g12]').forEach(btn => btn.addEventListener('click', () => handleRemoveMemberFromG12(btn.dataset.removeMemberFromG12, btn.dataset.pastorId)));
  qq('[data-member-tab]').forEach(btn => btn.addEventListener('click', () => {
    state.memberTab = btn.dataset.memberTab;
    state.growthFocus = btn.dataset.memberTab;
    applyMemberFilters();
    qq('[data-member-tab]').forEach(b => b.classList.toggle('active', b === btn));
  }));
  qq('[data-open-growth]').forEach(btn => btn.addEventListener('click', () => {
    state.growthFocus = btn.dataset.openGrowth;
    state.memberTab = btn.dataset.openGrowth;
    state.view = 'members';
    render();
  }));

  ['#memberDateFrom', '#memberDateTo', '#memberSearch', '#memberLevelFilter'].forEach(sel => {
    q(sel)?.addEventListener('input', () => { state.memberPageCount = 50; applyMemberFilters(); });
    q(sel)?.addEventListener('change', () => { state.memberPageCount = 50; applyMemberFilters(); });
  });
  q('[data-show-more-members]')?.addEventListener('click', () => { state.memberPageCount += 50; applyMemberFilters(); });
  q('[data-show-less-members]')?.addEventListener('click', () => { state.memberPageCount = 50; applyMemberFilters(); });
  applyMemberFilters();

  qq('[data-message-single-member]').forEach(btn => btn.addEventListener('click', () => {
    state.view = 'messages';
    render();
    setTimeout(() => {
      q('#messageAudienceType').value = 'single_member';
      syncMessageAudienceVisibility();
      q('select[name="memberId"]').value = btn.dataset.messageSingleMember;
      q('textarea[name="message"]').value = 'Hello {name}, we are glad to have you with us at Refiners City International Church.';
    }, 0);
  }));

  qq('[data-message-single-prospect]').forEach(btn => btn.addEventListener('click', () => {
    state.view = 'messages';
    render();
    setTimeout(() => {
      q('#messageAudienceType').value = 'single_prospect';
      syncMessageAudienceVisibility();
      q('select[name="prospectId"]').value = btn.dataset.messageSingleProspect;
      q('textarea[name="message"]').value = 'Hello {name}, we would love to welcome you again to Refiners City International Church.';
    }, 0);
  }));

  qq('[data-run-rule]').forEach(btn => btn.addEventListener('click', () => runRuleNow(btn.dataset.runRule)));
  qq('[data-quick-birthday]').forEach(btn => btn.addEventListener('click', () => {
    const targets = getBirthdaysToday(btn.dataset.quickBirthday);
    const message = 'Happy Birthday {name}. Refiners City International Church celebrates you today.';
    openWhatsappForTargets(targets, message);
  }));
  qq('[data-add-holiday]').forEach(btn => btn.addEventListener('click', () => addHolidayRule(btn.dataset.addHoliday)));
}

function handleAddMember(event) {
  event.preventDefault();
  const user = state.session;
  const fd = new FormData(event.target);
  const member = {
    id: uid('member'),
    fullName: String(fd.get('fullName')).trim(),
    phone: String(fd.get('phone')).trim(),
    address: String(fd.get('address')).trim(),
    birthday: String(fd.get('birthday') || ''),
    areaId: user.role === 'bishop' ? user.areaId : String(fd.get('areaId') || ''),
    g12PastorId: '',
    createdAt: nowStr(),
    createdByUserId: user.id,
  };
  state.db.members.push(member);
  saveDb();
  event.target.reset();
  showNotice('Member added successfully.');
  render();
}

function handleAddArea(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  state.db.areas.push({
    id: uid('area'),
    name: String(fd.get('name')).trim(),
    bishopName: String(fd.get('bishopName')).trim(),
    createdAt: nowStr(),
  });
  saveDb();
  event.target.reset();
  showNotice('Area created successfully.');
  render();
}

function handleEditArea(areaId) {
  state.editingAreaId = areaId;
  state.removingAreaId = null;
  render();
}

function handleSaveAreaEdit(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const area = getArea(String(fd.get('areaId')));
  if (!area) return;
  const nextName = String(fd.get('name') || '').trim();
  const nextBishop = String(fd.get('bishopName') || '').trim();
  if (!nextName) return;
  if (!nextBishop) return;
  area.name = nextName;
  area.bishopName = nextBishop;
  state.editingAreaId = null;
  saveDb();
  showNotice('Area updated successfully.');
  render();
}

function handleRemoveArea(areaId) {
  state.removingAreaId = areaId;
  state.editingAreaId = null;
  render();
}

function handleRemoveAreaConfirmed(areaId) {
  state.db.areas = state.db.areas.filter(a => a.id !== areaId);
  state.db.members.forEach(member => { if (member.areaId === areaId) member.areaId = ''; });
  state.db.prospects.forEach(person => { if (person.areaId === areaId) person.areaId = ''; });
  state.db.users.forEach(user => { if (user.areaId === areaId) user.areaId = ''; });
  if (state.areaFocusId === areaId) state.areaFocusId = '';
  state.removingAreaId = null;
  saveDb();
  showNotice('Area removed successfully.');
  render();
}

function handleCreateService(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const templateId = String(fd.get('templateId'));
  let template = templateId === 'custom' ? 'custom' : getServiceTemplate(templateId);
  const customTitle = String(fd.get('customTitle') || '').trim();
  const customName = String(fd.get('customName') || '').trim();
  const date = String(fd.get('date') || '');
  if (!date) {
    showNotice('Choose a calendar date for this service.', 'error');
    render();
    return;
  }
  if (templateId === 'add_statutory') {
    const label = String(fd.get('newStatutoryName') || '').trim();
    const dayOfWeek = String(fd.get('newStatutoryDay') || '').trim();
    const category = String(fd.get('newStatutoryCategory') || 'Statutory').trim();
    if (!label || !dayOfWeek) {
      showNotice('Complete the new statutory service details first.', 'error');
      render();
      return;
    }
    template = {
      id: uid('tmpl'),
      label,
      dayOfWeek,
      category,
      isStatutory: true,
      sortOrder: 100 + state.db.serviceTemplates.length,
    };
    state.db.serviceTemplates.push(template);
  }
  const name = buildServiceEventName(template, customTitle, customName);
  if (!name) {
    showNotice('Enter the custom service or activity name.', 'error');
    render();
    return;
  }
  const eventObj = {
    id: uid('event'),
    name,
    category: template === 'custom' ? 'Custom' : (template?.category || 'Statutory'),
    date,
    custom: template === 'custom',
    templateId: template === 'custom' ? '' : template.id,
    createdAt: nowStr(),
    createdByUserId: state.session.id,
  };
  state.db.serviceEvents.push(eventObj);
  state.selectedAttendanceEventId = eventObj.id;
  saveDb();
  event.target.reset();
  showNotice(templateId === 'add_statutory' ? 'Statutory service day added and event created.' : 'Service event created. Select it from the list to mark attendance.');
  render();
}

function handleAddServiceTemplate(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const label = String(fd.get('label') || '').trim();
  const dayOfWeek = String(fd.get('dayOfWeek') || '').trim();
  const category = String(fd.get('category') || 'Statutory').trim();
  if (!label || !dayOfWeek) {
    showNotice('Complete the statutory service details first.', 'error');
    render();
    return;
  }
  state.db.serviceTemplates.push({
    id: uid('tmpl'),
    label,
    dayOfWeek,
    category,
    isStatutory: true,
    sortOrder: 100 + state.db.serviceTemplates.length,
  });
  saveDb();
  event.target.reset();
  showNotice('Statutory service day added successfully.');
  render();
}

function handleAddProspect(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  state.db.prospects.push({
    id: uid('prospect'),
    fullName: String(fd.get('fullName')).trim(),
    phone: String(fd.get('phone')).trim(),
    address: String(fd.get('address')).trim(),
    birthday: String(fd.get('birthday') || ''),
    areaId: String(fd.get('areaId') || ''),
    createdAt: nowStr(),
  });
  saveDb();
  event.target.reset();
  showNotice('Non member saved.');
  render();
}

function handleMemberModalG12Save(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const member = getMember(String(fd.get('memberId')));
  if (!member) return;
  const targetPastorId = String(fd.get('g12PastorId') || '');
  const user = state.session;
  if (user.role === 'g12' && targetPastorId && targetPastorId !== user.id) {
    showNotice('You can only assign members to your own G12 class.', 'error');
    render();
    return;
  }
  if (user.role === 'g12' && member.g12PastorId && member.g12PastorId !== user.id) {
    const currentPastor = getUser(member.g12PastorId);
    showNotice(`This member already belongs to ${currentPastor?.className || currentPastor?.name || 'another G12 class'}.`, 'error');
    render();
    return;
  }
  member.g12PastorId = targetPastorId;
  saveDb();
  showNotice('G12 assignment updated successfully.');
  render();
}

function handleCreateG12Class(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const name = String(fd.get('name') || '').trim();
  const className = String(fd.get('className') || '').trim();
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const password = String(fd.get('password') || '').trim();
  if (!name || !className || !email || !password) {
    showNotice('Complete all G12 class details first.', 'error');
    render();
    return;
  }
  if (state.db.users.some(user => user.email.toLowerCase() === email)) {
    showNotice('That email is already in use.', 'error');
    render();
    return;
  }
  const pastor = {
    id: uid('user'),
    name,
    email,
    password,
    role: 'g12',
    className,
    areaId: '',
    createdAt: nowStr(),
  };
  state.db.users.push(pastor);
  state.g12FocusId = pastor.id;
  saveDb();
  event.target.reset();
  showNotice('G12 class created successfully.');
  render();
}

function handleG12ClassSettingsSave(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const pastor = getUser(String(fd.get('pastorId')));
  const className = String(fd.get('className') || '').trim();
  const memberId = String(fd.get('memberId') || '');
  const user = state.session;
  if (!pastor || !canManageG12Class(user, pastor.id)) return;
  if (!className) {
    showNotice('Enter a G12 class name.', 'error');
    render();
    return;
  }
  pastor.className = className;

  if (memberId) {
    const member = getMember(memberId);
    if (member) {
      if (member.g12PastorId && member.g12PastorId !== pastor.id) {
        const currentPastor = getUser(member.g12PastorId);
        showNotice(`Already added to ${currentPastor?.className || currentPastor?.name || 'another G12 group'}.`, 'error');
        render();
        return;
      }
      member.g12PastorId = pastor.id;
    }
  }

  saveDb();
  showNotice(memberId ? 'G12 class updated and member added successfully.' : 'G12 class updated successfully.');
  render();
}

function handleRemoveMemberFromG12(memberId, pastorId) {
  const user = state.session;
  if (!canManageG12Class(user, pastorId)) return;
  const member = getMember(memberId);
  if (!member || member.g12PastorId !== pastorId) return;
  member.g12PastorId = '';
  saveDb();
  showNotice('Member removed from G12 class.');
  render();
}

function bindAttendanceWorkspace() {
  qq('[data-attendance-member]').forEach(box => box.addEventListener('change', handleAttendanceToggle));
  q('#attendanceSearch')?.addEventListener('input', applyAttendanceFilters);
  q('#attendanceAreaFilter')?.addEventListener('change', applyAttendanceFilters);
  q('#absenceAreaFilter')?.addEventListener('change', handleAbsenceFilterChange);
  q('#absenceG12Filter')?.addEventListener('change', handleAbsenceFilterChange);
  q('#absenceLevelFilter')?.addEventListener('change', handleAbsenceFilterChange);
  q('[data-message-absentees-all]')?.addEventListener('click', () => handleAbsenteeMessaging('all'));
  q('[data-message-absentees-selected]')?.addEventListener('click', () => handleAbsenteeMessaging('selected'));
  q('#attendanceQuickMemberForm')?.addEventListener('submit', handleAttendanceQuickMemberAdd);
  q('[data-close-attendance-service]')?.addEventListener('click', handleCloseAttendanceService);
}

function handleAttendanceQuickMemberAdd(event) {
  event.preventDefault();
  const fd = new FormData(event.target);
  const eventId = String(fd.get('eventId') || state.selectedAttendanceEventId || '');
  const fullName = String(fd.get('fullName') || '').trim();
  if (!fullName || !eventId) {
    showNotice('Enter the person name first.', 'error');
    render();
    return;
  }
  const member = {
    id: uid('member'),
    fullName,
    phone: String(fd.get('phone') || '').trim(),
    address: String(fd.get('address') || '').trim(),
    birthday: '',
    areaId: String(fd.get('areaId') || ''),
    g12PastorId: '',
    createdAt: nowStr(),
    createdByUserId: state.session.id,
  };
  state.db.members.push(member);
  state.db.attendance.push({ id: uid('att'), memberId: member.id, eventId, markedByUserId: state.session.id, createdAt: nowStr() });
  saveDb();
  state.selectedAttendanceEventId = eventId;
  showNotice('New person added and marked present.');
  render();
}

function handleCloseAttendanceService() {
  state.selectedAttendanceEventId = '';
  showNotice('Service saved. You can reopen it anytime from Service History.');
  render();
}

function applyServiceHistoryFilters() {
  const search = q('#serviceHistorySearch')?.value.trim().toLowerCase() || '';
  const from = q('#serviceHistoryFrom')?.value || '';
  const to = q('#serviceHistoryTo')?.value || '';
  qq('[data-open-service-event]').forEach(item => {
    const name = item.dataset.serviceName || '';
    const date = item.dataset.serviceDate || '';
    const matchSearch = !search || name.includes(search);
    const matchFrom = !from || date >= from;
    const matchTo = !to || date <= to;
    item.classList.toggle('hidden', !(matchSearch && matchFrom && matchTo));
  });
}

function handleAttendanceToggle(event) {
  const memberId = event.target.dataset.attendanceMember;
  const eventId = event.target.dataset.event;
  const existing = state.db.attendance.find(a => a.memberId === memberId && a.eventId === eventId);
  if (event.target.checked && !existing) {
    state.db.attendance.push({ id: uid('att'), memberId, eventId, markedByUserId: state.session.id, createdAt: nowStr() });
  }
  if (!event.target.checked && existing) {
    state.db.attendance = state.db.attendance.filter(a => !(a.memberId === memberId && a.eventId === eventId));
  }
  saveDb();
  state.selectedAttendanceEventId = eventId;
  q('#attendanceWorkspace').innerHTML = renderAttendanceWorkspace(eventId);
  bindAttendanceWorkspace();
}

function handleAbsenceFilterChange() {
  state.absenceFilters = {
    areaId: q('#absenceAreaFilter')?.value || '',
    g12Id: q('#absenceG12Filter')?.value || '',
    level: q('#absenceLevelFilter')?.value || '',
  };
  if (!state.selectedAttendanceEventId) return;
  q('#attendanceWorkspace').innerHTML = renderAttendanceWorkspace(state.selectedAttendanceEventId);
  bindAttendanceWorkspace();
}

function handleAbsenteeMessaging(mode = 'all') {
  const eventId = state.selectedAttendanceEventId;
  if (!eventId) return;
  const eventObj = state.db.serviceEvents.find(item => item.id === eventId);
  let targets = getAbsenteesForEvent(eventId);
  if (mode === 'selected') {
    const selectedIds = qq('[data-absentee-checkbox]:checked').map(box => box.value);
    targets = targets.filter(member => selectedIds.includes(member.id));
  }
  if (!targets.length) {
    showNotice(mode === 'selected' ? 'Select at least one absentee first.' : 'No absentees match the current filters.', 'error');
    render();
    return;
  }
  openWhatsappForTargets(targets, `Hello {name}, we missed you at ${eventObj?.name || 'service'} today at Refiners City International Church. We hope you are well and would love to see you again.`);
}

function applyAttendanceFilters() {
  const search = q('#attendanceSearch')?.value.trim().toLowerCase() || '';
  const area = q('#attendanceAreaFilter')?.value || '';
  qq('[data-attendance-row]').forEach(row => {
    const matchSearch = !search || row.dataset.name.includes(search);
    const matchArea = !area || row.dataset.area === area;
    row.classList.toggle('hidden', !(matchSearch && matchArea));
  });
}

function applyMemberFilters() {
  const table = q('#membersTable tbody');
  if (!table) return;
  const from = q('#memberDateFrom')?.value || '';
  const to = q('#memberDateTo')?.value || '';
  const search = q('#memberSearch')?.value.trim().toLowerCase() || '';
  const levelFilter = q('#memberLevelFilter')?.value || '';
  const user = state.session;
  let members = getMembersForUser(user).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  members = getFilteredMembersForView({
    members,
    from,
    to,
    search,
    level: levelFilter,
    areaId: state.areaFocusId,
    g12Id: state.g12FocusId,
  });

  const visibleMembers = members.slice(0, state.memberPageCount);
  table.innerHTML = visibleMembers.length ? visibleMembers.map(member => {
    const profile = getMemberProfile(member);
    return `
      <tr>
        <td><button class="link-btn" data-open-member="${member.id}">${escapeHtml(member.fullName)}</button></td>
        <td>${escapeHtml(profile.areaName)}</td>
        <td>${escapeHtml(profile.g12Class)}</td>
        <td><span class="badge ${profile.level === LEVELS.strong ? 'success' : profile.level === LEVELS.consistent ? 'warn' : ''}">${escapeHtml(profile.level)}</span></td>
        <td>${profile.attendanceCount}</td>
        <td>${fmtDate(member.createdAt)}</td>
        <td>${escapeHtml(member.phone)}</td>
      </tr>
    `;
  }).join('') : `<tr><td colspan="7">No members match the current filters.</td></tr>`;

  qq('[data-open-member]', table).forEach(btn => btn.addEventListener('click', () => {
    state.modalMemberId = btn.dataset.openMember;
    render();
  }));

  const moreBtn = q('[data-show-more-members]');
  const lessBtn = q('[data-show-less-members]');
  if (moreBtn) moreBtn.disabled = visibleMembers.length >= members.length;
  if (lessBtn) lessBtn.disabled = state.memberPageCount <= 50;
}

function syncMessageAudienceVisibility() {
  const type = q('#messageAudienceType')?.value;
  if (!type) return;
  const groups = {
    area: '[data-message-area]',
    g12: '[data-message-g12]',
    single_member: '[data-message-single-member]',
    single_prospect: '[data-message-single-prospect]',
    selected_members: '[data-message-selected-members]',
    selected_prospects: '[data-message-selected-prospects]',
  };
  Object.values(groups).forEach(sel => q(sel)?.classList.add('hidden'));
  if (groups[type]) q(groups[type])?.classList.remove('hidden');
}

function collectMessageFormData() {
  const form = q('#messageForm');
  const fd = new FormData(form);
  const audienceType = String(fd.get('audienceType'));
  let audienceId = '';
  if (audienceType === 'area') audienceId = String(fd.get('audienceId'));
  if (audienceType === 'g12') audienceId = String(fd.get('g12Id'));
  if (audienceType === 'single_member') audienceId = String(fd.get('memberId'));
  if (audienceType === 'single_prospect') audienceId = String(fd.get('prospectId'));
  const selectedIds = audienceType === 'selected_members'
    ? qq('input[name="selectedMemberIds"]:checked').map(i => i.value)
    : audienceType === 'selected_prospects'
      ? qq('input[name="selectedProspectIds"]:checked').map(i => i.value)
      : [];
  return {
    audienceType,
    audienceId,
    selectedIds,
    message: String(fd.get('message')).trim(),
    scheduleDate: String(fd.get('scheduleDate') || ''),
    yearly: String(fd.get('yearly')) === 'true',
  };
}

function handleSendMessageNow(event) {
  event.preventDefault();
  const payload = collectMessageFormData();
  const targets = getMessageTargets(payload);
  if (!targets.length) {
    showNotice('No people matched the selected audience.', 'error');
    render();
    return;
  }
  openWhatsappForTargets(targets, payload.message);
}

function handleSaveMessageRule() {
  const payload = collectMessageFormData();
  if (!payload.message) {
    showNotice('Enter a message first.', 'error');
    render();
    return;
  }
  state.db.messageRules.push({
    id: uid('rule'),
    title: `Scheduled ${new Date().toLocaleTimeString()}`,
    type: 'scheduled',
    audienceType: payload.audienceType,
    audienceId: payload.audienceId,
    selectedIds: payload.selectedIds,
    message: payload.message,
    scheduleDate: payload.scheduleDate,
    yearly: payload.yearly,
    createdAt: nowStr(),
  });
  saveDb();
  showNotice('Message rule saved.');
  state.view = 'automation';
  render();
}

function runDailyAutomationCheck(showAlert = false) {
  const due = getDueAutomations();
  if (!due.length) {
    if (showAlert) {
      openDialog({
        title: 'Run Due Automations',
        message: 'No automation is due right now.',
        confirmLabel: 'OK',
      });
    }
    return;
  }
  if (showAlert) {
    openDialog({
      title: 'Run Due Automations',
      message: `You have <strong>${due.length}</strong> due automation(s). Open WhatsApp messages now?`,
      confirmLabel: 'Open Messages',
      cancelLabel: 'Cancel',
      onConfirm: () => {
        due.forEach(rule => runRuleNow(rule.id));
      },
    });
    return;
  }
  due.forEach(rule => runRuleNow(rule.id));
}

function runRuleNow(ruleId) {
  const rule = state.db.messageRules.find(r => r.id === ruleId);
  if (!rule) return;
  const targets = getAudience(rule);
  if (!targets.length) {
    showNotice('This rule currently has no matching audience.', 'error');
    render();
    return;
  }
  openWhatsappForTargets(targets, rule.message);
  markAutomationSent(rule.id);
  render();
}

function addHolidayRule(holidayName) {
  const year = new Date().getFullYear();
  const scheduleDate = holidayName === 'Christmas' ? `${year}-12-25` : computeEasterDate(year);
  const message = holidayName === 'Christmas'
    ? 'Merry Christmas from Refiners City International Church. The joy of Christ be with you.'
    : 'Happy Easter from Refiners City International Church. Christ is risen indeed.';
  state.db.messageRules.push({
    id: uid('rule'),
    title: `${holidayName} Greeting`,
    type: 'holiday',
    audienceType: 'everyone',
    audienceId: '',
    message,
    scheduleDate,
    yearly: true,
    createdAt: nowStr(),
  });
  saveDb();
  showNotice(`${holidayName} rule added.`);
  render();
}

render();
