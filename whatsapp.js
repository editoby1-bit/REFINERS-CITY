// Automatic WhatsApp sending (Church Admin only): settings, templates, send, delivery log, opt-outs.
// Works with supabase/whatsapp.sql and the wa-send / wa-webhook functions. Loaded before app.js;
// everything here runs only after the app has started.

const WA_VARIABLES = {
  name: 'Full name',
  first_name: 'First name',
  area: 'Area',
  service: 'Service name',
  date: 'Service date',
};
const WA_PURPOSES = {
  custom: 'General',
  birthday: 'Birthday',
  absentee: 'Absentee follow-up',
  holiday: 'Holiday greeting',
  announcement: 'Announcement',
  welcome: 'Welcome',
};
const WA_STATUS_LABELS = { queued: 'Waiting', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', skipped: 'Skipped' };
const WA_POLL_MS = 15000;
const WA_REFRESH_GAP_MS = 20000;

function waState() {
  state.wa ||= { loaded: false, loading: false, unavailable: false, settings: null, templates: [], batches: [], optouts: [], todayCount: 0, detail: null, loadedAt: 0, formError: '' };
  return state.wa;
}

function waIsAdmin() {
  return Boolean(CLOUD_ENABLED && state.session?.role === 'admin');
}

function waActiveTemplates(purpose = '') {
  return (waState().templates || []).filter(t => t.active && (!purpose || t.purpose === purpose));
}

// True when messages should go through the WhatsApp Business API instead of opening chats one by one.
function waApiMode() {
  const wa = waState();
  return Boolean(waIsAdmin() && wa.settings?.enabled && waActiveTemplates().length && state.waMode !== 'manual');
}

function waCountryCode() {
  return waState().settings?.default_country_code || DEFAULT_COUNTRY_CODE;
}

function waIsMissingTable(error) {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202' || /does not exist|schema cache|Could not find/i.test(error.message || '')));
}

async function loadWhatsappState(force = false) {
  const wa = waState();
  if (!CLOUD_ENABLED || !state.cloudUserId || wa.loading) return false;
  if (!force && wa.loaded && Date.now() - wa.loadedAt < WA_REFRESH_GAP_MS) return false;
  wa.loading = true;
  try {
    const [settings, templates] = await Promise.all([
      cloud.from('wa_settings').select('*').eq('id', 1).maybeSingle(),
      cloud.from('wa_templates').select('*').order('label'),
    ]);
    if (waIsMissingTable(settings.error) || waIsMissingTable(templates.error)) {
      wa.unavailable = true;
      return true;
    }
    if (settings.error) throw settings.error;
    if (templates.error) throw templates.error;
    wa.unavailable = false;
    wa.settings = settings.data;
    wa.templates = templates.data || [];
    if (waIsAdmin()) {
      const [batches, today, optouts] = await Promise.all([
        cloud.rpc('wa_batch_summary'),
        cloud.rpc('wa_today_count'),
        cloud.from('wa_optouts').select('*').order('created_at', { ascending: false }).limit(500),
      ]);
      if (!batches.error) wa.batches = batches.data || [];
      if (!today.error) wa.todayCount = Number(today.data) || 0;
      if (!optouts.error) wa.optouts = optouts.data || [];
      if (wa.detail?.batchId) await waLoadDetail(wa.detail.batchId, true);
    }
  } catch (error) {
    console.warn('Could not load WhatsApp settings', error);
  } finally {
    wa.loaded = true;
    wa.loading = false;
    wa.loadedAt = Date.now();
  }
  return true;
}

async function waRefreshAndRender() {
  await loadWhatsappState(true);
  render();
}

function waAnyActiveBatch() {
  return (waState().batches || []).some(batch => Number(batch.queued) + Number(batch.sending) > 0);
}

// ---------- Values for {{1}}, {{2}}, ... ----------
function waVariableValue(key, target, context = {}) {
  const name = (target.fullName || target.name || '').trim() || 'Friend';
  if (key === 'name') return name;
  if (key === 'first_name') return name.split(/\s+/)[0];
  if (key === 'area') return getArea(target.areaId)?.name || 'Refiners City';
  if (key === 'service') return context.serviceName || '';
  if (key === 'date') return context.serviceDate || '';
  return '';
}

function waTemplateNeeds(template, key) {
  return (template.variables || []).includes(key);
}

function waTemplateProblem(template, context = {}) {
  if (waTemplateNeeds(template, 'service') && !context.serviceName) return 'This template includes the service name, so it can only be used from a service\'s absentee list.';
  if (waTemplateNeeds(template, 'date') && !context.serviceDate) return 'This template includes the service date, so it can only be used from a service\'s absentee list.';
  return '';
}

function waPreviewText(template) {
  return String(template.body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const key = (template.variables || [])[Number(n) - 1];
    return `[${WA_VARIABLES[key] || '?'}]`;
  });
}

function waFindTemplate(value) {
  const [name, language] = String(value || '').split('|');
  return waState().templates.find(t => t.name === name && t.language === (language || 'en')) || null;
}

function waBuildRows(targets, template, context = {}) {
  const prospectIds = new Set(state.db.prospects.map(p => p.id));
  return targets.map(target => ({
    recipient_type: prospectIds.has(target.id) ? 'prospect' : 'member',
    recipient_id: target.id,
    name: target.fullName || target.name || '',
    phone: target.phone || '',
    params: (template.variables || []).map(key => waVariableValue(key, target, context)),
  }));
}

// ---------- Sending ----------
function waConfirmAndSend({ targets, template, kind = 'manual', context = {}, afterQueued = null }) {
  const wa = waState();
  const problem = waTemplateProblem(template, context);
  if (problem) {
    showNotice(problem, 'error');
    render();
    return;
  }
  const cc = waCountryCode();
  const valid = new Set();
  let noPhone = 0;
  const optedOut = new Set((wa.optouts || []).map(o => o.phone));
  let blocked = 0;
  targets.forEach(target => {
    const phone = normalizePhone(target.phone || '', cc);
    if (!phone) noPhone += 1;
    else if (optedOut.has(phone)) blocked += 1;
    else valid.add(phone);
  });
  if (!valid.size) {
    showNotice(noPhone ? 'None of these people have a valid phone number.' : 'Everyone selected has opted out.', 'error');
    render();
    return;
  }
  const limit = wa.settings?.daily_limit || 250;
  const left = Math.max(limit - wa.todayCount, 0);
  const days = Math.ceil(Math.max(valid.size - left, 0) / limit);
  const notes = [];
  if (noPhone) notes.push(`${noPhone} without a valid phone number will be skipped.`);
  if (blocked) notes.push(`${blocked} who opted out will be skipped.`);
  if (valid.size > left) notes.push(`Meta allows ${limit} different people per 24 hours and ${wa.todayCount} have been used, so about ${left} go out now and the rest continue automatically over ${days} more day${days === 1 ? '' : 's'}.`);
  openDialog({
    title: 'Send WhatsApp messages',
    tone: valid.size > 50 ? 'danger' : 'info',
    message: `Send <strong>${escapeHtml(template.label || template.name)}</strong> to <strong>${valid.size}</strong> ${valid.size === 1 ? 'person' : 'people'}?<br /><br /><em>${escapeHtml(waPreviewText(template))}</em>${notes.length ? `<br /><br />${notes.map(escapeHtml).join('<br />')}` : ''}<br /><br />Meta charges for each template message it delivers.`,
    confirmLabel: `Send to ${valid.size}`,
    cancelLabel: 'Cancel',
    onConfirm: () => { waEnqueue(targets, template, kind, context).then(afterQueued || (() => {})); },
  });
}

async function waEnqueue(targets, template, kind, context) {
  const rows = waBuildRows(targets, template, context);
  const totals = { queued: 0, no_phone: 0, opted_out: 0, duplicates: 0 };
  for (let i = 0; i < rows.length; i += 2000) {
    const { data, error } = await cloud.rpc('wa_enqueue', {
      p_kind: kind, p_template: template.name, p_language: template.language, p_rows: rows.slice(i, i + 2000),
    });
    if (error) {
      showNotice(error.message || 'Could not queue the messages.', 'error');
      await loadWhatsappState(true);
      render();
      return false;
    }
    Object.keys(totals).forEach(key => { totals[key] += Number(data[key]) || 0; });
  }
  const extra = [totals.duplicates ? `${totals.duplicates} already messaged in the last 20 hours` : '', totals.opted_out ? `${totals.opted_out} opted out` : '', totals.no_phone ? `${totals.no_phone} without a valid number` : ''].filter(Boolean);
  showNotice(totals.queued
    ? `${totals.queued} message${totals.queued === 1 ? '' : 's'} queued for sending${extra.length ? ` (skipped: ${extra.join(', ')})` : ''}.`
    : `Nothing was queued${extra.length ? `: ${extra.join(', ')}` : ''}.`, totals.queued ? 'success' : 'error');
  state.view = 'messages';
  await loadWhatsappState(true);
  render();
  return totals.queued > 0;
}

// Called from the Send Now button when API mode is on.
function waSendFromForm() {
  const payload = collectMessageFormData();
  const template = waFindTemplate(q('#waTemplateSelect')?.value);
  if (!template) {
    showNotice('Choose a template first.', 'error');
    render();
    return;
  }
  const targets = getMessageTargets(payload);
  if (!targets.length) {
    showNotice('No people matched the selected audience.', 'error');
    render();
    return;
  }
  waConfirmAndSend({ targets, template, kind: 'manual' });
}

function waSendAbsentees(targets, eventObj) {
  const templates = waActiveTemplates('absentee');
  if (!templates.length) {
    showNotice('Add an absentee follow-up template under WhatsApp Centre > Templates first.', 'error');
    render();
    return;
  }
  waConfirmAndSend({
    targets,
    template: templates[0],
    kind: 'absentee',
    context: { serviceName: eventObj?.name || 'service', serviceDate: waLongDate(eventObj?.date) },
  });
}

function waSendBirthdays(targets) {
  const templates = waActiveTemplates('birthday');
  if (!templates.length) {
    showNotice('Add a birthday template under WhatsApp Centre > Templates first.', 'error');
    render();
    return;
  }
  waConfirmAndSend({ targets, template: templates[0], kind: 'birthday' });
}

function waLongDate(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- Screens ----------
function renderWhatsappStatusCard() {
  if (!waIsAdmin()) return '';
  const wa = waState();
  if (wa.unavailable) {
    return `<section class="card"><h3>Automatic WhatsApp</h3><div class="notice">Automatic sending is not set up yet. Follow WHATSAPP_SETUP.md: run <strong>supabase/whatsapp.sql</strong> in Supabase, deploy the two functions, and add the Meta secrets. Until then, messages open WhatsApp chats one by one.</div></section>`;
  }
  if (!wa.settings) return `<section class="card"><h3>Automatic WhatsApp</h3><div class="empty">Loading…</div></section>`;
  const s = wa.settings;
  const state_ = !s.enabled ? ['neutral', 'Off'] : s.paused ? ['danger-badge', 'Paused'] : ['success', 'On'];
  return `
    <section class="card" id="waStatusCard">
      <div class="flow-heading"><div><h3>Automatic WhatsApp <span class="badge ${state_[0]}">${state_[1]}</span></h3>
        <p class="footer-note">Messages are sent in the background through the WhatsApp Business API, even when nobody has the app open.</p></div></div>
      ${s.last_error ? `<div class="notice danger-box"><strong>Sending stopped:</strong> ${escapeHtml(s.last_error)}<br /><small>${fmtDateTime(s.last_error_at)}. Fix the problem (see WHATSAPP_SETUP.md), then press Resume.</small></div>` : ''}
      ${!waActiveTemplates().length && s.enabled ? `<div class="notice">Add at least one approved template below, then the Send button will use automatic sending.</div>` : ''}
      <form id="waSettingsForm" class="form-grid">
        <div class="field"><label>Automatic sending</label>
          <select name="enabled"><option value="false" ${s.enabled ? '' : 'selected'}>Off (open chats one by one)</option><option value="true" ${s.enabled ? 'selected' : ''}>On</option></select></div>
        <div class="field"><label>People per 24 hours (Meta limit)</label><input type="number" name="dailyLimit" min="1" max="1000000" value="${s.daily_limit}" />
          <small>Starts at 250, 1,000 once the business is verified. Extra people wait until the next day.</small></div>
        <div class="field"><label>Phone country code</label><input name="countryCode" value="${escapeHtml(s.default_country_code)}" /><small>Numbers like 0803… become +${escapeHtml(s.default_country_code)}803…</small></div>
        <div class="field"><label>Used in the last 24 hours</label><input value="${wa.todayCount} of ${s.daily_limit}" disabled /></div>
        <div class="inline-actions" style="grid-column:1/-1;">
          <button class="btn" type="submit">Save</button>
          ${s.enabled ? `<button class="btn secondary" type="button" data-wa-pause="${s.paused ? 'false' : 'true'}">${s.paused ? 'Resume sending' : 'Pause sending'}</button>` : ''}
        </div>
      </form>
    </section>
  `;
}

// The audience form uses this in place of the free-text message box.
function renderWhatsappTemplateField() {
  const templates = waActiveTemplates();
  const first = templates[0];
  return `
    <div class="field" style="grid-column:1/-1;" data-wa-template-field>
      <label>WhatsApp template</label>
      <select name="templateKey" id="waTemplateSelect">${templates.map(t => `<option value="${escapeHtml(t.name)}|${escapeHtml(t.language)}">${escapeHtml(t.label || t.name)} (${escapeHtml(WA_PURPOSES[t.purpose] || t.purpose)})</option>`).join('')}</select>
      <div class="message-preview" id="waPreview">${first ? escapeHtml(waPreviewText(first)) : ''}</div>
      <small>Automatic messages must use a template that Meta has approved. <button class="link-btn" type="button" data-wa-manual-mode>Use free tap-to-send instead</button></small>
    </div>
  `;
}

function renderWhatsappLog() {
  if (!waIsAdmin() || waState().unavailable || !waState().settings) return '';
  const wa = waState();
  const bar = (b) => {
    const total = Math.max(Number(b.total), 1);
    const pct = (n) => `${(Number(n) / total) * 100}%`;
    return `<div class="wa-bar" title="${WA_STATUS_LABELS.read}: ${b.read}, ${WA_STATUS_LABELS.delivered}: ${b.delivered}, ${WA_STATUS_LABELS.sent}: ${b.sent}">
      <span class="wa-read" style="width:${pct(b.read)}"></span><span class="wa-delivered" style="width:${pct(b.delivered)}"></span><span class="wa-sent" style="width:${pct(b.sent)}"></span>
      <span class="wa-active" style="width:${pct(Number(b.queued) + Number(b.sending))}"></span><span class="wa-failed" style="width:${pct(b.failed)}"></span><span class="wa-skipped" style="width:${pct(b.skipped)}"></span></div>`;
  };
  return `
    <section class="card" id="waLogCard">
      <div class="flow-heading"><div><h3>Delivery Log</h3><p class="footer-note">Recent sends. Delivered and Read come back from WhatsApp; this page refreshes by itself while messages are waiting.</p></div>
        <button class="btn tiny secondary" type="button" data-wa-refresh>Refresh</button></div>
      ${wa.batches.length ? `<div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Message</th><th>People</th><th>Progress</th><th>Waiting</th><th>Delivered</th><th>Read</th><th>Failed</th><th>Skipped</th><th></th></tr></thead>
        <tbody>${wa.batches.map(b => `
          <tr>
            <td>${fmtDateTime(b.created_at)}</td>
            <td>${escapeHtml(b.template_name)}<div class="member-meta">${escapeHtml(b.kind)}</div></td>
            <td>${b.total}</td>
            <td style="min-width:120px;">${bar(b)}</td>
            <td>${Number(b.queued) + Number(b.sending)}</td>
            <td>${Number(b.delivered) + Number(b.read)}</td>
            <td>${b.read}</td>
            <td>${b.failed}</td>
            <td>${b.skipped}</td>
            <td><div class="inline-actions">
              <button class="btn tiny secondary" type="button" data-wa-detail="${b.batch_id}">Details</button>
              ${Number(b.failed) ? `<button class="btn tiny" type="button" data-wa-retry="${b.batch_id}">Retry ${b.failed} failed</button>` : ''}
              ${Number(b.queued) ? `<button class="btn tiny danger" type="button" data-wa-cancel="${b.batch_id}">Cancel ${b.queued} waiting</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody></table></div>` : `<div class="empty">Nothing has been sent yet.</div>`}
      ${wa.detail ? renderWhatsappDetail(wa.detail) : ''}
    </section>
  `;
}

function renderWhatsappDetail(detail) {
  const rows = detail.rows || [];
  return `
    <div class="section-gap-top">
      <div class="flow-heading"><h3>Problems in this send</h3><button class="btn tiny secondary" type="button" data-wa-detail-close>Close</button></div>
      ${detail.loading ? '<div class="empty">Loading…</div>' : rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Why</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${escapeHtml(r.recipient_name || '—')}</td><td>${escapeHtml(r.phone || '—')}</td><td><span class="badge ${r.status === 'failed' ? 'danger-badge' : 'neutral'}">${WA_STATUS_LABELS[r.status] || r.status}</span></td><td>${escapeHtml(r.error || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No failed or skipped messages in this send.</div>'}
    </div>`;
}

function renderWhatsappTemplates() {
  if (!waIsAdmin() || waState().unavailable || !waState().settings) return '';
  const templates = waState().templates;
  const slot = (n) => `<div class="field"><label>{{${n}}} is filled with</label><select name="var${n}"><option value="">(not used)</option>${Object.entries(WA_VARIABLES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>`;
  return `
    <details class="card" id="waTemplatesCard" ${waState().templatesOpen || !templates.length ? 'open' : ''}>
      <summary><strong>Templates</strong> <span class="member-meta">approved by Meta (${templates.length})</span></summary>
      <div class="notice section-gap-top">Create each template in <strong>Meta Business Manager &gt; WhatsApp Manager &gt; Message templates</strong> and wait for approval. Then add it here with <em>exactly</em> the same name and language. The app does not check with Meta, so a template Meta has not approved will show as Failed.</div>
      ${templates.length ? `<div class="table-wrap section-gap-top"><table>
        <thead><tr><th>Label</th><th>Meta name</th><th>Lang</th><th>Used for</th><th>Text</th><th>On</th><th></th></tr></thead>
        <tbody>${templates.map(t => `<tr>
          <td>${escapeHtml(t.label || '—')}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.language)}</td><td>${escapeHtml(WA_PURPOSES[t.purpose] || t.purpose)}</td>
          <td>${escapeHtml(waPreviewText(t))}</td>
          <td><input type="checkbox" data-wa-template-active="${escapeHtml(t.id)}" ${t.active ? 'checked' : ''} /></td>
          <td><button class="btn tiny danger" type="button" data-wa-template-delete="${escapeHtml(t.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3 class="section-gap-top">Add a template</h3>
      ${waState().formError ? `<div class="notice danger-box">${escapeHtml(waState().formError)}</div>` : ''}
      <form id="waTemplateForm" class="form-grid">
        <div class="field"><label>Label (for you)</label><input name="label" placeholder="Birthday blessing" required /></div>
        <div class="field"><label>Template name at Meta</label><input name="name" placeholder="birthday_blessing" pattern="[a-z0-9_]+" required /></div>
        <div class="field"><label>Language code</label><input name="language" value="en" required /></div>
        <div class="field"><label>Used for</label><select name="purpose">${Object.entries(WA_PURPOSES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1;"><label>Template text (as approved by Meta)</label><textarea name="body" placeholder="Happy birthday {{1}}! Refiners City International Church celebrates you today." required></textarea></div>
        ${[1, 2, 3, 4].map(slot).join('')}
        <div class="inline-actions" style="grid-column:1/-1;"><button class="btn" type="submit">Add template</button></div>
      </form>
    </details>
  `;
}

function renderWhatsappOptoutsAndTest() {
  if (!waIsAdmin() || waState().unavailable || !waState().settings) return '';
  const wa = waState();
  const templates = waActiveTemplates();
  return `
    <section class="two-col top-align">
      <div class="card">
        <h3>Send a Test Message</h3>
        <p class="footer-note">Check that everything works by sending one message to your own number.</p>
        <form id="waTestForm" class="form-grid single">
          <div class="field"><label>Your WhatsApp number</label><input name="phone" placeholder="0803 000 0000" required /></div>
          <div class="field"><label>Template</label><select name="templateKey">${templates.map(t => `<option value="${escapeHtml(t.name)}|${escapeHtml(t.language)}">${escapeHtml(t.label || t.name)}</option>`).join('')}</select></div>
          <button class="btn" type="submit" ${templates.length && wa.settings.enabled ? '' : 'disabled'}>Send test</button>
        </form>
      </div>
      <div class="card">
        <h3>Opted Out (${wa.optouts.length})</h3>
        <p class="footer-note">People who replied STOP are never messaged. You can also add a number by hand.</p>
        <form id="waOptoutForm" class="toolbar compact-toolbar"><div class="field"><label>Number</label><input name="phone" required /></div><div class="field" style="align-self:end;"><button class="btn tiny" type="submit">Add</button></div></form>
        ${wa.optouts.length ? `<div class="checklist" style="max-height:200px;">${wa.optouts.map(o => `<div class="check-row"><div><strong>+${escapeHtml(o.phone)}</strong><div class="member-meta">${escapeHtml(o.reason || '')} ${fmtDate(o.created_at)}</div></div><button class="btn tiny secondary" type="button" data-wa-optout-remove="${escapeHtml(o.phone)}">Allow again</button></div>`).join('')}</div>` : '<div class="empty">Nobody has opted out.</div>'}
      </div>
    </section>
  `;
}

// ---------- Events ----------
async function waLoadDetail(batchId, silent = false) {
  const wa = waState();
  wa.detail = { batchId, loading: !silent, rows: wa.detail?.batchId === batchId ? wa.detail.rows : [] };
  if (!silent) render();
  const { data, error } = await cloud.from('wa_outbox').select('recipient_name,phone,status,error')
    .eq('batch_id', batchId).in('status', ['failed', 'skipped']).order('status').limit(300);
  wa.detail = { batchId, loading: false, rows: error ? [] : data };
  if (!silent) render();
}

function waRpcNotice(error, okMessage) {
  showNotice(error ? (error.message || 'Something went wrong.') : okMessage, error ? 'error' : 'success');
}

function bindWhatsapp() {
  if (!waIsAdmin()) return;
  const wa = waState();

  q('#waSettingsForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const { error } = await cloud.rpc('wa_update_settings', {
      p_enabled: String(fd.get('enabled')) === 'true',
      p_paused: wa.settings.paused,
      p_daily_limit: Math.max(1, Number(fd.get('dailyLimit')) || 250),
      p_country_code: String(fd.get('countryCode') || ''),
    });
    waRpcNotice(error, 'WhatsApp settings saved.');
    await waRefreshAndRender();
  });
  q('[data-wa-pause]')?.addEventListener('click', async (event) => {
    const pause = event.target.dataset.waPause === 'true';
    const { error } = await cloud.rpc('wa_update_settings', { p_enabled: wa.settings.enabled, p_paused: pause, p_daily_limit: wa.settings.daily_limit, p_country_code: wa.settings.default_country_code });
    waRpcNotice(error, pause ? 'Sending paused.' : 'Sending resumed.');
    await waRefreshAndRender();
  });

  q('#waTemplateSelect')?.addEventListener('change', (event) => {
    const template = waFindTemplate(event.target.value);
    const preview = q('#waPreview');
    if (preview && template) preview.textContent = waPreviewText(template);
  });
  q('[data-wa-manual-mode]')?.addEventListener('click', () => { state.waMode = 'manual'; render(); });
  q('[data-wa-api-mode]')?.addEventListener('click', () => { state.waMode = 'api'; render(); });

  q('#waTemplateForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const body = String(fd.get('body') || '').trim();
    const placeholders = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    const needed = placeholders.length ? Math.max(...placeholders) : 0;
    const variables = [1, 2, 3, 4].map(n => String(fd.get(`var${n}`) || '')).filter(Boolean);
    let problem = '';
    if (needed > 4) problem = 'Templates with more than 4 values are not supported.';
    else if (variables.length !== needed || [1, 2, 3, 4].slice(0, needed).some(n => !fd.get(`var${n}`))) problem = `The text uses ${needed} value${needed === 1 ? '' : 's'} ({{1}}${needed > 1 ? `…{{${needed}}}` : ''}): choose what fills each one, in order, and leave the rest as "(not used)".`;
    wa.formError = problem;
    if (problem) { render(); return; }
    const record = {
      id: uid('tpl'), name: String(fd.get('name')).trim(), language: String(fd.get('language')).trim() || 'en', label: String(fd.get('label')).trim(),
      purpose: String(fd.get('purpose')), body, variables, active: true,
    };
    const { error } = await cloud.from('wa_templates').insert(record);
    waRpcNotice(error ? { message: /duplicate/i.test(error.message) ? 'A template with that id already exists.' : error.message } : null, 'Template added.');
    wa.templatesOpen = true;
    await waRefreshAndRender();
  });
  qq('[data-wa-template-active]').forEach(box => box.addEventListener('change', async () => {
    const { error } = await cloud.from('wa_templates').update({ active: box.checked }).eq('id', box.dataset.waTemplateActive);
    waRpcNotice(error, box.checked ? 'Template switched on.' : 'Template switched off.');
    wa.templatesOpen = true;
    await waRefreshAndRender();
  }));
  qq('[data-wa-template-delete]').forEach(btn => btn.addEventListener('click', () => {
    const template = wa.templates.find(t => t.id === btn.dataset.waTemplateDelete);
    openDialog({
      title: 'Delete template', tone: 'danger', cancelLabel: 'Cancel', confirmLabel: 'Delete',
      message: `Delete the template <strong>${escapeHtml(template?.label || template?.name || '')}</strong>? Rules that use it stop sending until you choose another.`,
      onConfirm: () => { cloud.from('wa_templates').delete().eq('id', btn.dataset.waTemplateDelete).then(({ error }) => { waRpcNotice(error, 'Template deleted.'); wa.templatesOpen = true; waRefreshAndRender(); }); },
    });
  }));

  q('[data-wa-refresh]')?.addEventListener('click', () => waRefreshAndRender());
  qq('[data-wa-detail]').forEach(btn => btn.addEventListener('click', () => waLoadDetail(btn.dataset.waDetail)));
  q('[data-wa-detail-close]')?.addEventListener('click', () => { wa.detail = null; render(); });
  qq('[data-wa-retry]').forEach(btn => btn.addEventListener('click', async () => {
    const { data, error } = await cloud.rpc('wa_retry_failed', { p_batch: btn.dataset.waRetry });
    waRpcNotice(error, `${data || 0} failed message(s) put back in the queue.`);
    await waRefreshAndRender();
  }));
  qq('[data-wa-cancel]').forEach(btn => btn.addEventListener('click', () => openDialog({
    title: 'Cancel waiting messages', tone: 'danger', cancelLabel: 'Keep sending', confirmLabel: 'Cancel them',
    message: 'Stop the messages in this send that have not gone out yet? Messages already sent cannot be recalled.',
    onConfirm: () => { cloud.rpc('wa_cancel_queued', { p_batch: btn.dataset.waCancel }).then(({ data, error }) => { waRpcNotice(error, `${data || 0} message(s) cancelled.`); waRefreshAndRender(); }); },
  })));

  q('#waTestForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const template = waFindTemplate(fd.get('templateKey'));
    if (!template) return;
    const me = state.session;
    const target = { id: `test_${me.id}`, fullName: me.name || 'Test', phone: String(fd.get('phone') || ''), areaId: me.areaId || '' };
    const context = { serviceName: 'Sunday Service', serviceDate: waLongDate(todayStr()) };
    const { data, error } = await cloud.rpc('wa_enqueue', { p_kind: 'test', p_template: template.name, p_language: template.language, p_rows: waBuildRows([target], template, context) });
    waRpcNotice(error, data?.queued ? 'Test message queued: it should arrive within a minute.' : 'The number is not valid or has opted out.');
    await waRefreshAndRender();
  });
  q('#waOptoutForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { error } = await cloud.rpc('wa_admin_optout', { p_phone: String(new FormData(event.target).get('phone') || ''), p_add: true });
    waRpcNotice(error, 'Number added to the opted-out list.');
    await waRefreshAndRender();
  });
  qq('[data-wa-optout-remove]').forEach(btn => btn.addEventListener('click', async () => {
    const { error } = await cloud.rpc('wa_admin_optout', { p_phone: btn.dataset.waOptoutRemove, p_add: false });
    waRpcNotice(error, 'This number can be messaged again.');
    await waRefreshAndRender();
  }));
}

// Rules (Automation Rules page): pick which template a rule sends.
function waRuleTemplateSelect(rule) {
  if (!waApiMode()) return '';
  const current = rule.templateName ? `${rule.templateName}|${rule.templateLanguage || 'en'}` : '';
  return `<select class="mini-select" data-wa-rule-template="${rule.id}"><option value="">Not sent automatically</option>${waActiveTemplates().map(t => {
    const value = `${t.name}|${t.language}`;
    const unsupported = (t.variables || []).some(v => v === 'service' || v === 'date');
    return `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''} ${unsupported ? 'disabled' : ''}>${escapeHtml(t.label || t.name)}${unsupported ? ' (needs a service)' : ''}</option>`;
  }).join('')}</select>`;
}

function bindWhatsappRules() {
  qq('[data-wa-rule-template]').forEach(select => select.addEventListener('change', () => {
    const rule = state.db.messageRules.find(r => r.id === select.dataset.waRuleTemplate);
    if (!rule) return;
    const template = waFindTemplate(select.value);
    rule.templateName = template ? template.name : '';
    rule.templateLanguage = template ? template.language : '';
    saveDb();
    showNotice(template ? 'This rule will now send automatically every morning at 8:00.' : 'This rule is no longer sent automatically.');
    render();
  }));
}

// Refresh the log while messages are waiting.
if (CLOUD_ENABLED) {
  setInterval(() => {
    if (document.hidden || state.view !== 'messages' || !waIsAdmin() || !waAnyActiveBatch()) return;
    loadWhatsappState(true).then(() => requestRemoteRender());
  }, WA_POLL_MS);
}
