const STORAGE_KEY = 'refiners_city_attendance_v1';

const sundayPresets = ['Sunday - 1st Service', 'Sunday - 2nd Service', 'Sunday - 3rd Service', 'Sunday - 4th Service'];
const midweekPreset = 'Midweek Service';

const appState = {
  db: null,
  session: null,
  authMode: 'login',
  toast: ''
};

function seedDatabase() {
  const today = new Date().toISOString().slice(0, 10);
  const services = [
    { id: uid(), title: sundayPresets[0], type: 'statutory', category: 'Sunday', date: today, createdBy: 'system' },
    { id: uid(), title: sundayPresets[1], type: 'statutory', category: 'Sunday', date: today, createdBy: 'system' },
    { id: uid(), title: sundayPresets[2], type: 'statutory', category: 'Sunday', date: today, createdBy: 'system' },
    { id: uid(), title: sundayPresets[3], type: 'statutory', category: 'Sunday', date: today, createdBy: 'system' },
    { id: uid(), title: midweekPreset, type: 'statutory', category: 'Wednesday', date: today, createdBy: 'system' }
  ];

  const adminId = uid();
  const ordainedId = uid();
  const g12Id = uid();

  const members = [
    { id: uid(), fullName: 'Mary Johnson', phone: '08030000001', address: '12 Grace Avenue', groupId: null, createdAt: today },
    { id: uid(), fullName: 'Daniel Peters', phone: '08030000002', address: '4 Zion Street', groupId: null, createdAt: today },
    { id: uid(), fullName: 'Sarah Bassey', phone: '08030000003', address: '21 Faith Estate', groupId: null, createdAt: today },
    { id: uid(), fullName: 'Michael Udo', phone: '08030000004', address: '7 Mercy Close', groupId: null, createdAt: today },
    { id: uid(), fullName: 'Joy Emmanuel', phone: '08030000005', address: '6 Covenant Road', groupId: null, createdAt: today },
  ];

  const groupId = uid();
  members[0].groupId = groupId;
  members[1].groupId = groupId;

  return {
    users: [
      { id: adminId, role: 'admin', fullName: 'Church Admin', username: 'admin', password: 'admin123', className: null },
      { id: ordainedId, role: 'ordained', fullName: 'Pastor Samuel', username: 'ordained', password: 'pastor123', className: null },
      { id: g12Id, role: 'g12', fullName: 'Pastor Toby', username: 'g12toby', password: 'g12123', className: "Pastor Toby's Class" }
    ],
    g12Groups: [
      { id: groupId, pastorId: g12Id, pastorName: 'Pastor Toby', className: "Pastor Toby's Class", createdAt: today }
    ],
    members,
    services,
    attendance: [],
    metadata: { churchName: 'Refiners City International Church' }
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function loadDB() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDatabase();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  return JSON.parse(raw);
}

function saveDB() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.db));
}

function showToast(message) {
  appState.toast = message;
  render();
  setTimeout(() => {
    if (appState.toast === message) {
      appState.toast = '';
      render();
    }
  }, 2600);
}

function init() {
  appState.db = loadDB();
  render();
}

function setSession(user) {
  appState.session = {
    user,
    screen: defaultScreenForRole(user.role)
  };
  render();
}

function logout() {
  appState.session = null;
  render();
}

function defaultScreenForRole(role) {
  if (role === 'admin') return 'dashboard';
  if (role === 'g12') return 'g12-dashboard';
  return 'pastor-dashboard';
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = appState.session ? renderDashboardShell() : renderAuth();
  bindEvents();
}

function renderAuth() {
  return `
    <div class="auth-wrap">
      <div class="auth-brand">
        <img src="assets/logo.jpg" alt="Church logo" />
        <div class="stack">
          <h1>Refiners City Attendance & Member Database</h1>
          <p>
            Full church member database, service attendance tracking, statutory Sunday and midweek service records,
            custom conferences and events, plus role-based dashboards for church administration, ordained pastors and G12 pastors.
          </p>
        </div>
        <div class="auth-note">
          <strong>Demo access</strong><br>
          Admin: <b>admin / admin123</b><br>
          Ordained Pastor: <b>ordained / pastor123</b><br>
          G12 Pastor: <b>g12toby / g12123</b>
        </div>
      </div>

      <div class="auth-card-wrap">
        <div class="card auth-card stack">
          <div>
            <div class="auth-tabs">
              <button class="${appState.authMode === 'login' ? 'active' : ''}" data-auth-mode="login">Sign In</button>
              <button class="${appState.authMode === 'signup' ? 'active' : ''}" data-auth-mode="signup">Create Account</button>
            </div>
          </div>
          ${appState.authMode === 'login' ? renderLoginForm() : renderSignupForm()}
        </div>
      </div>
    </div>
    ${renderToast()}
  `;
}

function renderLoginForm() {
  return `
    <form id="login-form" class="stack">
      <div>
        <h2 style="margin:0 0 6px;">Welcome back</h2>
        <p class="muted" style="margin:0;">Sign in to continue to your role-specific dashboard.</p>
      </div>
      <div class="field">
        <label>Username</label>
        <input name="username" placeholder="Enter username" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input name="password" type="password" placeholder="Enter password" required />
      </div>
      <button class="btn btn-primary" type="submit">Sign In</button>
    </form>
  `;
}

function renderSignupForm() {
  return `
    <form id="signup-form" class="stack">
      <div>
        <h2 style="margin:0 0 6px;">Create a new role account</h2>
        <p class="muted" style="margin:0;">G12 pastors can define their class name during signup.</p>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Full Name</label>
          <input name="fullName" placeholder="Enter full name" required />
        </div>
        <div class="field">
          <label>Username</label>
          <input name="username" placeholder="Choose username" required />
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Password</label>
          <input name="password" type="password" placeholder="Create password" required />
        </div>
        <div class="field">
          <label>Role</label>
          <select name="role" id="signup-role-select" required>
            <option value="ordained">Ordained Pastor</option>
            <option value="g12">G12 Pastor</option>
            <option value="admin">Church Admin</option>
          </select>
        </div>
      </div>
      <div class="field" id="class-name-field" style="display:none;">
        <label>G12 Class Name</label>
        <input name="className" placeholder="Example: Pastor Toby's Class" />
      </div>
      <button class="btn btn-primary" type="submit">Create Account</button>
    </form>
  `;
}

function renderDashboardShell() {
  const { user } = appState.session;
  const navItems = getNavItems(user.role);
  const activeScreen = appState.session.screen;

  return `
    <div class="app-shell">
      <div class="topbar">
        <div class="topbar-inner">
          <div class="brand">
            <img src="assets/logo.jpg" alt="Church logo">
            <div>
              <div class="brand-title">Refiners City Attendance</div>
              <div class="brand-sub">${appState.db.metadata.churchName}</div>
            </div>
          </div>
          <div class="top-actions">
            <div class="role-pill">${roleLabel(user.role)}</div>
            <div class="role-pill">${escapeHtml(user.fullName)}</div>
            ${user.role === 'g12' && user.className ? `<div class="role-pill">${escapeHtml(user.className)}</div>` : ''}
            <button class="btn btn-outline" id="logout-btn">Logout</button>
          </div>
        </div>
      </div>

      <div class="layout">
        <aside class="card sidebar">
          <h3>Navigation</h3>
          <div class="nav-list">
            ${navItems.map(item => `
              <button class="nav-btn ${item.key === activeScreen ? 'active' : ''}" data-screen="${item.key}">
                <span>${item.label}</span>
                <small>${item.hint}</small>
              </button>
            `).join('')}
          </div>
        </aside>

        <main class="content">
          ${renderScreen(activeScreen, user)}
        </main>
      </div>

      <div class="footer-note">Built as a full browser-based attendance and member management system. Data is saved in local browser storage for demo use.</div>
    </div>
    ${renderToast()}
  `;
}

function getNavItems(role) {
  if (role === 'admin') {
    return [
      { key: 'dashboard', label: 'Dashboard', hint: 'Overview' },
      { key: 'members', label: 'Members Database', hint: 'Manage members' },
      { key: 'services', label: 'Services & Activities', hint: 'Create services' },
      { key: 'attendance', label: 'Attendance Marking', hint: 'Admin only' },
      { key: 'groups', label: 'G12 Groups', hint: 'Monitor classes' },
      { key: 'reports', label: 'Reports', hint: 'Attendance summary' }
    ];
  }
  if (role === 'g12') {
    return [
      { key: 'g12-dashboard', label: 'Dashboard', hint: 'Class view' },
      { key: 'g12-members', label: 'My G12 Class', hint: 'Read only stats' },
      { key: 'g12-assign', label: 'Assign Members', hint: 'Manage class' },
      { key: 'g12-services', label: 'Services', hint: 'Attendance insight' }
    ];
  }
  return [
    { key: 'pastor-dashboard', label: 'Dashboard', hint: 'Read only' },
    { key: 'pastor-members', label: 'Members', hint: 'View database' },
    { key: 'pastor-services', label: 'Services', hint: 'Attendance view' },
    { key: 'pastor-groups', label: 'G12 Groups', hint: 'View classes' }
  ];
}

function renderScreen(screen, user) {
  switch (screen) {
    case 'dashboard': return renderAdminDashboard();
    case 'members': return renderMembersPage();
    case 'services': return renderServicesPage();
    case 'attendance': return renderAttendancePage();
    case 'groups': return renderGroupsPage();
    case 'reports': return renderReportsPage();
    case 'g12-dashboard': return renderG12Dashboard(user);
    case 'g12-members': return renderG12MembersPage(user);
    case 'g12-assign': return renderG12AssignPage(user);
    case 'g12-services': return renderG12ServicesPage(user);
    case 'pastor-dashboard': return renderOrdainedDashboard();
    case 'pastor-members': return renderReadonlyMembers();
    case 'pastor-services': return renderReadonlyServices();
    case 'pastor-groups': return renderReadonlyGroups();
    default: return '<div class="empty-state">Screen not found.</div>';
  }
}

function renderAdminDashboard() {
  const { members, services, attendance, g12Groups } = appState.db;
  const latestServices = [...services].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return `
    <section class="section-head">
      <div>
        <h2>Church Admin Dashboard</h2>
        <p>Admin can manage the member database, create services and mark attendance.</p>
      </div>
    </section>

    <section class="kpi-grid">
      <div class="card kpi"><small>Total Members</small><strong>${members.length}</strong><span>All registered members in the database</span></div>
      <div class="card kpi"><small>Total Services</small><strong>${services.length}</strong><span>Statutory and custom activities combined</span></div>
      <div class="card kpi"><small>Attendance Marks</small><strong>${attendance.length}</strong><span>Total marked attendance entries</span></div>
      <div class="card kpi"><small>G12 Classes</small><strong>${g12Groups.length}</strong><span>Active G12 pastor groups</span></div>
    </section>

    <section class="two-col">
      <div class="card panel">
        <div class="panel-head"><h3>Recent Services</h3><span class="muted">Quick view of upcoming or recent activities</span></div>
        <div class="service-grid">
          ${latestServices.map(service => serviceCard(service)).join('') || '<div class="empty-state">No services available.</div>'}
        </div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h3>Quick Actions</h3><span class="muted">Administrative shortcuts</span></div>
        <div class="stack">
          <button class="btn btn-primary" data-screen-jump="members">Add New Member</button>
          <button class="btn btn-secondary" data-screen-jump="services">Create Service / Conference</button>
          <button class="btn btn-soft" data-screen-jump="attendance">Mark Attendance</button>
          <button class="btn btn-outline" data-screen-jump="reports">Open Reports</button>
        </div>
      </div>
    </section>
  `;
}

function renderMembersPage() {
  const members = [...appState.db.members].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return `
    <section class="section-head">
      <div>
        <h2>Members Database</h2>
        <p>Store full name, address and phone number for church members.</p>
      </div>
    </section>

    <section class="two-col">
      <div class="card panel">
        <div class="panel-head"><h3>Add New Member</h3><span class="muted">Church-wide database entry</span></div>
        <form id="member-form" class="stack">
          <div class="field">
            <label>Full Name</label>
            <input name="fullName" placeholder="Enter full name" required>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Phone Number</label>
              <input name="phone" placeholder="Enter phone number" required>
            </div>
            <div class="field">
              <label>Address</label>
              <input name="address" placeholder="Enter address" required>
            </div>
          </div>
          <button class="btn btn-primary" type="submit">Save Member</button>
        </form>
      </div>

      <div class="card panel">
        <div class="panel-head"><h3>Member Summary</h3><span class="muted">Current database health</span></div>
        <div class="kpi-grid" style="grid-template-columns:repeat(2, minmax(0, 1fr));">
          <div class="card kpi"><small>Total</small><strong>${members.length}</strong><span>Registered members</span></div>
          <div class="card kpi"><small>Assigned to G12</small><strong>${members.filter(m => m.groupId).length}</strong><span>Already in classes</span></div>
        </div>
      </div>
    </section>

    <section class="card panel">
      <div class="panel-head"><h3>All Members</h3><span class="muted">General list available to admins and pastors</span></div>
      ${members.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th><th>Phone</th><th>Address</th><th>G12 Class</th><th>Attendance Marks</th>
            </tr>
          </thead>
          <tbody>
            ${members.map(member => `
              <tr>
                <td>${escapeHtml(member.fullName)}</td>
                <td>${escapeHtml(member.phone)}</td>
                <td>${escapeHtml(member.address)}</td>
                <td>${groupName(member.groupId)}</td>
                <td>${countMemberAttendance(member.id)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">No members added yet.</div>'}
    </section>
  `;
}

function renderServicesPage() {
  const services = [...appState.db.services].sort((a, b) => (b.date + b.title).localeCompare(a.date + a.title));
  return `
    <section class="section-head">
      <div>
        <h2>Services & Activities</h2>
        <p>Create statutory and custom church activities. Sundays and midweek can be tracked alongside conferences and special events.</p>
      </div>
    </section>

    <section class="two-col">
      <div class="card panel">
        <div class="panel-head"><h3>Create Custom Activity</h3><span class="muted">For conferences, programs and special services</span></div>
        <form id="service-form" class="stack">
          <div class="grid-2">
            <div class="field">
              <label>Activity Title</label>
              <input name="title" placeholder="Example: Youth Conference Day 1" required>
            </div>
            <div class="field">
              <label>Date</label>
              <input name="date" type="date" required>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label>Category</label>
              <select name="category">
                <option>Custom Activity</option>
                <option>Conference</option>
                <option>Special Service</option>
                <option>Retreat</option>
              </select>
            </div>
            <div class="field">
              <label>Type</label>
              <select name="type">
                <option value="custom">Custom</option>
                <option value="conference">Conference</option>
                <option value="special">Special</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary" type="submit">Add Activity</button>
        </form>
      </div>

      <div class="card panel">
        <div class="panel-head"><h3>Statutory Services</h3><span class="muted">Always available</span></div>
        <div class="service-grid">
          ${[...sundayPresets, midweekPreset].map(name => `
            <div class="card service-card">
              <h4>${name}</h4>
              <p>Built-in service option in the attendance system.</p>
              <span class="badge badge-primary">Statutory</span>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <section class="card panel">
      <div class="panel-head"><h3>All Services & Activities</h3><span class="muted">Attendance can be marked only by church admin</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Title</th><th>Date</th><th>Category</th><th>Type</th><th>Attendance Count</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${services.map(service => `
              <tr>
                <td>${escapeHtml(service.title)}</td>
                <td>${escapeHtml(service.date)}</td>
                <td>${escapeHtml(service.category)}</td>
                <td>${escapeHtml(service.type)}</td>
                <td>${countServiceAttendance(service.id)}</td>
                <td><span class="badge badge-success">Open</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAttendancePage() {
  const members = [...appState.db.members].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const serviceOptions = [...appState.db.services].sort((a, b) => (b.date + b.title).localeCompare(a.date + a.title));
  const selectedServiceId = serviceOptions[0]?.id || '';

  return `
    <section class="section-head">
      <div>
        <h2>Attendance Marking</h2>
        <p>Only church admin can mark attendance. Pastors have read-only visibility.</p>
      </div>
    </section>

    <section class="card panel stack">
      <div class="panel-head"><h3>Mark Attendance by Service</h3><span class="muted">Select a service, then tick members who attended</span></div>
      ${serviceOptions.length ? `
        <div class="search-row">
          <div class="field">
            <label>Select Service / Activity</label>
            <select id="attendance-service-select">
              ${serviceOptions.map(service => `<option value="${service.id}">${escapeHtml(service.title)} — ${escapeHtml(service.date)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Search Member</label>
            <input id="attendance-search" placeholder="Search by name">
          </div>
          <div class="field">
            <label>Quick Action</label>
            <button id="mark-visible-btn" class="btn btn-primary" type="button">Mark Visible Members</button>
          </div>
        </div>

        <div id="attendance-list-wrap">${renderAttendanceList(selectedServiceId, '')}</div>
      ` : '<div class="empty-state">Create a service first before marking attendance.</div>'}
    </section>
  `;
}

function renderAttendanceList(serviceId, query) {
  const members = [...appState.db.members]
    .filter(member => member.fullName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  if (!members.length) return '<div class="empty-state">No matching members found.</div>';

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Mark</th><th>Name</th><th>Phone</th><th>Address</th><th>G12 Class</th><th>Already Marked</th></tr>
        </thead>
        <tbody>
          ${members.map(member => {
            const marked = isAttendanceMarked(serviceId, member.id);
            return `
              <tr>
                <td><input type="checkbox" class="attendance-check" data-service-id="${serviceId}" data-member-id="${member.id}" ${marked ? 'checked' : ''}></td>
                <td>${escapeHtml(member.fullName)}</td>
                <td>${escapeHtml(member.phone)}</td>
                <td>${escapeHtml(member.address)}</td>
                <td>${groupName(member.groupId)}</td>
                <td>${marked ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-dark">No</span>'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGroupsPage() {
  const groups = [...appState.db.g12Groups];
  return `
    <section class="section-head">
      <div>
        <h2>G12 Groups</h2>
        <p>Monitor all pastor-led classes and member allocations.</p>
      </div>
    </section>

    <section class="card panel">
      <div class="panel-head"><h3>All G12 Classes</h3><span class="muted">Members cannot belong to two classes</span></div>
      ${groups.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Class Name</th><th>Pastor</th><th>Members</th><th>Total Attendance</th></tr></thead>
          <tbody>
            ${groups.map(group => `
              <tr>
                <td>${escapeHtml(group.className)}</td>
                <td>${escapeHtml(group.pastorName)}</td>
                <td>${membersInGroup(group.id).length}</td>
                <td>${groupAttendanceTotal(group.id)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">No G12 classes created yet.</div>'}
    </section>
  `;
}

function renderReportsPage() {
  const services = [...appState.db.services].sort((a, b) => (b.date + b.title).localeCompare(a.date + a.title));
  return `
    <section class="section-head">
      <div>
        <h2>Attendance Reports</h2>
        <p>Quick service-level report across the church.</p>
      </div>
    </section>
    <section class="card panel">
      <div class="panel-head"><h3>Service Attendance Summary</h3><span class="muted">Totals for each service or activity</span></div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Service</th><th>Date</th><th>Total Attendance</th><th>Assigned G12 Members Present</th><th>Unassigned Members Present</th></tr></thead>
          <tbody>
            ${services.map(service => {
              const marks = appState.db.attendance.filter(item => item.serviceId === service.id);
              const groupMembersPresent = marks.filter(item => memberById(item.memberId)?.groupId).length;
              return `
                <tr>
                  <td>${escapeHtml(service.title)}</td>
                  <td>${escapeHtml(service.date)}</td>
                  <td>${marks.length}</td>
                  <td>${groupMembersPresent}</td>
                  <td>${marks.length - groupMembersPresent}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderG12Dashboard(user) {
  const group = groupByPastor(user.id);
  const members = membersInGroup(group?.id);
  const services = appState.db.services;
  return `
    <section class="section-head">
      <div>
        <h2>G12 Pastor Dashboard</h2>
        <p>Read-only attendance visibility plus class management for your own group.</p>
      </div>
    </section>

    <section class="kpi-grid">
      <div class="card kpi"><small>Class Name</small><strong style="font-size:20px;">${escapeHtml(group?.className || user.className || 'Not set')}</strong><span>Named according to the pastor</span></div>
      <div class="card kpi"><small>My Members</small><strong>${members.length}</strong><span>Members currently under your G12 class</span></div>
      <div class="card kpi"><small>Total Services</small><strong>${services.length}</strong><span>All services visible to you</span></div>
      <div class="card kpi"><small>My Attendance Marks</small><strong>${groupAttendanceTotal(group?.id)}</strong><span>Combined class attendance across services</span></div>
    </section>

    <section class="card panel">
      <div class="panel-head"><h3>Attendance by Service</h3><span class="muted">How many of your G12 members attended each service</span></div>
      ${renderG12ServiceTable(user)}
    </section>
  `;
}

function renderG12MembersPage(user) {
  const group = groupByPastor(user.id);
  const members = membersInGroup(group?.id);
  return `
    <section class="section-head">
      <div>
        <h2>My G12 Class</h2>
        <p>Read-only list of members already assigned to your class.</p>
      </div>
    </section>
    <section class="card panel">
      <div class="panel-head"><h3>${escapeHtml(group?.className || user.className || 'My Class')}</h3><span class="muted">Members under your discipleship group</span></div>
      ${members.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Total Attendance</th></tr></thead>
          <tbody>
            ${members.map(member => `
              <tr>
                <td>${escapeHtml(member.fullName)}</td>
                <td>${escapeHtml(member.phone)}</td>
                <td>${escapeHtml(member.address)}</td>
                <td>${countMemberAttendance(member.id)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty-state">No members assigned to your class yet.</div>'}
    </section>
  `;
}

function renderG12AssignPage(user) {
  const group = ensureGroupForUser(user);
  const members = [...appState.db.members].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return `
    <section class="section-head">
      <div>
        <h2>Assign Members to My G12 Class</h2>
        <p>You can assign members from the general list to your class. A member already in another class cannot be added.</p>
      </div>
    </section>
    <section class="two-col">
      <div class="card panel">
        <div class="panel-head"><h3>General Member List</h3><span class="muted">Pick available members only</span></div>
        <div class="member-pick-list">
          ${members.map(member => {
            const assignedElsewhere = member.groupId && member.groupId !== group.id;
            const assignedHere = member.groupId === group.id;
            return `
              <div class="pick-item ${assignedElsewhere ? 'disabled' : ''}">
                <div class="pick-meta">
                  <strong>${escapeHtml(member.fullName)}</strong>
                  <span>${escapeHtml(member.phone)} · ${escapeHtml(member.address)}</span>
                  <span>${assignedElsewhere ? 'Already belongs to ' + groupName(member.groupId) : assignedHere ? 'Already in your class' : 'Available to assign'}</span>
                </div>
                <div class="inline-actions">
                  <button class="btn ${assignedHere ? 'btn-danger' : 'btn-primary'}" type="button" data-assign-member="${member.id}" ${assignedElsewhere ? 'disabled' : ''}>
                    ${assignedHere ? 'Remove' : 'Assign'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="card panel">
        <div class="panel-head"><h3>Class Details</h3><span class="muted">Editable class naming</span></div>
        <form id="class-name-form" class="stack">
          <div class="field">
            <label>Pastor Name</label>
            <input value="${escapeHtml(user.fullName)}" disabled>
          </div>
          <div class="field">
            <label>Class Name</label>
            <input name="className" value="${escapeHtml(group.className)}" required>
          </div>
          <button class="btn btn-primary" type="submit">Update Class Name</button>
        </form>

        <div style="height:16px"></div>
        <div class="auth-note">
          Default style follows your example like <b>Pastor Toby's Class</b>. You can rename your own class here.
        </div>
      </div>
    </section>
  `;
}

function renderG12ServicesPage(user) {
  return `
    <section class="section-head">
      <div>
        <h2>Services Attendance Insight</h2>
        <p>Read-only service level insight for your own class.</p>
      </div>
    </section>
    <section class="card panel">
      <div class="panel-head"><h3>My Class Attendance by Service</h3><span class="muted">Total church attendance versus your class attendance</span></div>
      ${renderG12ServiceTable(user, true)}
    </section>
  `;
}

function renderG12ServiceTable(user, compare = false) {
  const group = groupByPastor(user.id);
  const services = [...appState.db.services].sort((a, b) => (b.date + b.title).localeCompare(a.date + a.title));
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Service</th><th>Date</th>${compare ? '<th>Total Church Attendance</th>' : ''}<th>My Class Attendance</th></tr></thead>
        <tbody>
          ${services.map(service => `
            <tr>
              <td>${escapeHtml(service.title)}</td>
              <td>${escapeHtml(service.date)}</td>
              ${compare ? `<td>${countServiceAttendance(service.id)}</td>` : ''}
              <td>${groupServiceAttendance(group?.id, service.id)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOrdainedDashboard() {
  const totalAttendance = appState.db.attendance.length;
  return `
    <section class="section-head">
      <div>
        <h2>Ordained Pastor Dashboard</h2>
        <p>Read-only overview of member, group and attendance activity.</p>
      </div>
    </section>
    <section class="kpi-grid">
      <div class="card kpi"><small>Total Members</small><strong>${appState.db.members.length}</strong><span>All registered members</span></div>
      <div class="card kpi"><small>Total Services</small><strong>${appState.db.services.length}</strong><span>All church services and activities</span></div>
      <div class="card kpi"><small>Total Attendance</small><strong>${totalAttendance}</strong><span>All attendance marks church-wide</span></div>
      <div class="card kpi"><small>G12 Classes</small><strong>${appState.db.g12Groups.length}</strong><span>Visible for oversight</span></div>
    </section>
    <section class="card panel">
      <div class="panel-head"><h3>Recent Attendance Summary</h3><span class="muted">Read-only service attendance list</span></div>
      ${renderReadonlyServicesTable()}
    </section>
  `;
}

function renderReadonlyMembers() {
  return `
    <section class="section-head"><div><h2>Members</h2><p>Read-only access to the church member database.</p></div></section>
    <section class="card panel">${readonlyMembersTable()}</section>
  `;
}

function renderReadonlyServices() {
  return `
    <section class="section-head"><div><h2>Services</h2><p>Read-only access to church attendance by service.</p></div></section>
    <section class="card panel">${renderReadonlyServicesTable()}</section>
  `;
}

function renderReadonlyGroups() {
  return `
    <section class="section-head"><div><h2>G12 Groups</h2><p>View pastor-led classes and their attendance totals.</p></div></section>
    <section class="card panel">${readonlyGroupsTable()}</section>
  `;
}

function readonlyMembersTable() {
  const members = [...appState.db.members].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return members.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Class</th><th>Total Attendance</th></tr></thead>
        <tbody>
          ${members.map(member => `
            <tr>
              <td>${escapeHtml(member.fullName)}</td>
              <td>${escapeHtml(member.phone)}</td>
              <td>${escapeHtml(member.address)}</td>
              <td>${groupName(member.groupId)}</td>
              <td>${countMemberAttendance(member.id)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : '<div class="empty-state">No members available.</div>';
}

function renderReadonlyServicesTable() {
  const services = [...appState.db.services].sort((a, b) => (b.date + b.title).localeCompare(a.date + a.title));
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Service</th><th>Date</th><th>Category</th><th>Total Attendance</th></tr></thead>
        <tbody>
          ${services.map(service => `
            <tr>
              <td>${escapeHtml(service.title)}</td>
              <td>${escapeHtml(service.date)}</td>
              <td>${escapeHtml(service.category)}</td>
              <td>${countServiceAttendance(service.id)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function readonlyGroupsTable() {
  const groups = appState.db.g12Groups;
  return groups.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Class Name</th><th>Pastor</th><th>Members</th><th>Total Attendance</th></tr></thead>
        <tbody>
          ${groups.map(group => `
            <tr>
              <td>${escapeHtml(group.className)}</td>
              <td>${escapeHtml(group.pastorName)}</td>
              <td>${membersInGroup(group.id).length}</td>
              <td>${groupAttendanceTotal(group.id)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty-state">No groups created yet.</div>';
}

function serviceCard(service) {
  return `
    <div class="card service-card">
      <h4>${escapeHtml(service.title)}</h4>
      <p>${escapeHtml(service.date)} · ${escapeHtml(service.category)}</p>
      <div class="inline-actions">
        <span class="badge ${service.type === 'statutory' ? 'badge-primary' : 'badge-warning'}">${escapeHtml(service.type)}</span>
        <span class="badge badge-success">${countServiceAttendance(service.id)} present</span>
      </div>
    </div>
  `;
}

function renderToast() {
  return appState.toast ? `<div class="toast">${escapeHtml(appState.toast)}</div>` : '';
}

function bindEvents() {
  document.querySelectorAll('[data-auth-mode]').forEach(btn => {
    btn.onclick = () => {
      appState.authMode = btn.dataset.authMode;
      render();
    };
  });

  const roleSelect = document.getElementById('signup-role-select');
  if (roleSelect) {
    const classField = document.getElementById('class-name-field');
    const toggleClassField = () => classField.style.display = roleSelect.value === 'g12' ? 'grid' : 'none';
    toggleClassField();
    roleSelect.onchange = toggleClassField;
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(loginForm);
      const username = String(data.get('username')).trim();
      const password = String(data.get('password')).trim();
      const user = appState.db.users.find(u => u.username === username && u.password === password);
      if (!user) return showToast('Invalid login details.');
      setSession(user);
      showToast('Signed in successfully.');
    };
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(signupForm);
      const username = String(data.get('username')).trim();
      if (appState.db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return showToast('Username already exists.');
      }
      const role = String(data.get('role'));
      const user = {
        id: uid(),
        fullName: String(data.get('fullName')).trim(),
        username,
        password: String(data.get('password')).trim(),
        role,
        className: null
      };
      if (role === 'g12') {
        const className = String(data.get('className')).trim() || `${user.fullName}'s Class`;
        user.className = className;
        appState.db.g12Groups.push({ id: uid(), pastorId: user.id, pastorName: user.fullName, className, createdAt: todayDate() });
      }
      appState.db.users.push(user);
      saveDB();
      appState.authMode = 'login';
      render();
      showToast('Account created successfully. You can now sign in.');
    };
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.onclick = logout;

  document.querySelectorAll('[data-screen]').forEach(btn => {
    btn.onclick = () => {
      appState.session.screen = btn.dataset.screen;
      render();
    };
  });

  document.querySelectorAll('[data-screen-jump]').forEach(btn => {
    btn.onclick = () => {
      appState.session.screen = btn.dataset.screenJump;
      render();
    };
  });

  const memberForm = document.getElementById('member-form');
  if (memberForm) {
    memberForm.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(memberForm);
      appState.db.members.push({
        id: uid(),
        fullName: String(data.get('fullName')).trim(),
        phone: String(data.get('phone')).trim(),
        address: String(data.get('address')).trim(),
        groupId: null,
        createdAt: todayDate()
      });
      saveDB();
      render();
      showToast('Member added successfully.');
    };
  }

  const serviceForm = document.getElementById('service-form');
  if (serviceForm) {
    serviceForm.onsubmit = (e) => {
      e.preventDefault();
      const data = new FormData(serviceForm);
      appState.db.services.unshift({
        id: uid(),
        title: String(data.get('title')).trim(),
        date: String(data.get('date')).trim(),
        category: String(data.get('category')).trim(),
        type: String(data.get('type')).trim(),
        createdBy: appState.session.user.id
      });
      saveDB();
      render();
      showToast('Service or custom activity created.');
    };
  }

  const attendanceSelect = document.getElementById('attendance-service-select');
  const attendanceSearch = document.getElementById('attendance-search');
  const attendanceListWrap = document.getElementById('attendance-list-wrap');
  if (attendanceSelect && attendanceSearch && attendanceListWrap) {
    const syncList = () => {
      attendanceListWrap.innerHTML = renderAttendanceList(attendanceSelect.value, attendanceSearch.value);
      bindAttendanceCheckboxes();
    };
    attendanceSelect.onchange = syncList;
    attendanceSearch.oninput = syncList;
    syncList();
  }

  const markVisibleBtn = document.getElementById('mark-visible-btn');
  if (markVisibleBtn && attendanceSelect && attendanceSearch) {
    markVisibleBtn.onclick = () => {
      const filtered = appState.db.members.filter(member => member.fullName.toLowerCase().includes(attendanceSearch.value.toLowerCase()));
      filtered.forEach(member => markAttendance(attendanceSelect.value, member.id, true, false));
      saveDB();
      const wrap = document.getElementById('attendance-list-wrap');
      if (wrap) wrap.innerHTML = renderAttendanceList(attendanceSelect.value, attendanceSearch.value);
      bindAttendanceCheckboxes();
      showToast('Visible members marked present.');
    };
  }

  document.querySelectorAll('[data-assign-member]').forEach(btn => {
    btn.onclick = () => {
      const memberId = btn.dataset.assignMember;
      toggleGroupAssignment(appState.session.user.id, memberId);
    };
  });

  const classNameForm = document.getElementById('class-name-form');
  if (classNameForm) {
    classNameForm.onsubmit = (e) => {
      e.preventDefault();
      const form = new FormData(classNameForm);
      const className = String(form.get('className')).trim();
      updateClassName(appState.session.user.id, className);
    };
  }
}

function bindAttendanceCheckboxes() {
  document.querySelectorAll('.attendance-check').forEach(input => {
    input.onchange = () => {
      markAttendance(input.dataset.serviceId, input.dataset.memberId, input.checked, true);
    };
  });
}

function markAttendance(serviceId, memberId, checked, notify) {
  const existingIndex = appState.db.attendance.findIndex(item => item.serviceId === serviceId && item.memberId === memberId);
  if (checked && existingIndex === -1) {
    appState.db.attendance.push({ id: uid(), serviceId, memberId, markedAt: new Date().toISOString(), markedBy: appState.session.user.id });
  }
  if (!checked && existingIndex !== -1) {
    appState.db.attendance.splice(existingIndex, 1);
  }
  saveDB();
  const serviceIdEl = document.getElementById('attendance-service-select');
  const searchEl = document.getElementById('attendance-search');
  const wrap = document.getElementById('attendance-list-wrap');
  if (serviceIdEl && searchEl && wrap) {
    wrap.innerHTML = renderAttendanceList(serviceIdEl.value, searchEl.value);
    bindAttendanceCheckboxes();
  }
  if (notify) showToast(checked ? 'Attendance marked.' : 'Attendance removed.');
}

function toggleGroupAssignment(pastorId, memberId) {
  const group = ensureGroupForUser(userById(pastorId));
  const member = memberById(memberId);
  if (!member) return;
  if (member.groupId && member.groupId !== group.id) {
    return showToast('This member already belongs to a different G12 class.');
  }
  member.groupId = member.groupId === group.id ? null : group.id;
  saveDB();
  render();
  showToast(member.groupId ? 'Member assigned to your class.' : 'Member removed from your class.');
}

function updateClassName(pastorId, className) {
  const group = ensureGroupForUser(userById(pastorId));
  group.className = className;
  group.pastorName = userById(pastorId).fullName;
  const user = userById(pastorId);
  if (user) user.className = className;
  saveDB();
  render();
  showToast('Class name updated successfully.');
}

function ensureGroupForUser(user) {
  let group = groupByPastor(user.id);
  if (!group) {
    group = {
      id: uid(),
      pastorId: user.id,
      pastorName: user.fullName,
      className: user.className || `${user.fullName}'s Class`,
      createdAt: todayDate()
    };
    appState.db.g12Groups.push(group);
    saveDB();
  }
  return group;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function roleLabel(role) {
  if (role === 'admin') return 'Church Admin';
  if (role === 'ordained') return 'Ordained Pastor';
  return 'G12 Pastor';
}

function userById(id) {
  return appState.db.users.find(user => user.id === id);
}

function memberById(id) {
  return appState.db.members.find(member => member.id === id);
}

function groupByPastor(pastorId) {
  return appState.db.g12Groups.find(group => group.pastorId === pastorId);
}

function membersInGroup(groupId) {
  return appState.db.members.filter(member => member.groupId === groupId);
}

function groupName(groupId) {
  if (!groupId) return '<span class="badge badge-dark">Unassigned</span>';
  const group = appState.db.g12Groups.find(item => item.id === groupId);
  return group ? `<span class="badge badge-primary">${escapeHtml(group.className)}</span>` : '<span class="badge badge-dark">Unknown</span>';
}

function countMemberAttendance(memberId) {
  return appState.db.attendance.filter(item => item.memberId === memberId).length;
}

function countServiceAttendance(serviceId) {
  return appState.db.attendance.filter(item => item.serviceId === serviceId).length;
}

function groupAttendanceTotal(groupId) {
  if (!groupId) return 0;
  const memberIds = new Set(membersInGroup(groupId).map(member => member.id));
  return appState.db.attendance.filter(item => memberIds.has(item.memberId)).length;
}

function groupServiceAttendance(groupId, serviceId) {
  if (!groupId) return 0;
  const memberIds = new Set(membersInGroup(groupId).map(member => member.id));
  return appState.db.attendance.filter(item => item.serviceId === serviceId && memberIds.has(item.memberId)).length;
}

function isAttendanceMarked(serviceId, memberId) {
  return appState.db.attendance.some(item => item.serviceId === serviceId && item.memberId === memberId);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('DOMContentLoaded', init);
