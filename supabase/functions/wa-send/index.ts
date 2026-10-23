// @ts-nocheck
// wa-send: sends queued WhatsApp template messages through Meta's WhatsApp Business Cloud API.
// Called every minute (and right after the admin presses Send) by the database, using a shared secret.
// Settings (Supabase > Edge Functions > Secrets): WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_CRON_SECRET.
// Optional: WA_API_VERSION (default v23.0). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are added by Supabase.

const CLAIM_SIZE = 100;
const CONCURRENCY = 20;

// Errors that mean "nothing can be sent until a person fixes something": stop and pause sending.
const ABORT_CODES = new Set([190, 102, 10, 368, 131042, 131031, 133010, 133005]);
// Temporary: try again later.
const RETRY_CODES = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131056, 131000, 131016, 133016]);

const FRIENDLY = {
  131026: 'This number is not on WhatsApp',
  131030: 'Number is not on the allowed list (the app is still in Meta test mode)',
  131047: 'More than 24 hours since this person last wrote: a template is required',
  131049: 'Meta chose not to deliver this message to this person (try later)',
  131051: 'Unsupported message type',
  132000: 'The template needs a different number of values',
  132001: 'Template not found at Meta (check its name and language)',
  132005: 'Translated template text is too long',
  132007: 'Template text breaks a WhatsApp policy',
  132012: 'Template value has the wrong format',
  132015: 'This template is paused by Meta',
  132016: 'This template is disabled by Meta',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Meta rejects template values with line breaks, tabs or long runs of spaces.
function cleanParam(value) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1000);
  return text || '-';
}

export function buildPayload(row) {
  const params = Array.isArray(row.params) ? row.params : [];
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: row.phone,
    type: 'template',
    template: {
      name: row.template_name,
      language: { code: row.language || 'en' },
      components: params.length ? [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: cleanParam(text) })) }] : [],
    },
  };
}

// Turns Meta's answer into what the database should record.
export function classifyFailure(status, body) {
  const err = (body && body.error) || {};
  const code = Number(err.code) || 0;
  const details = (err.error_data && err.error_data.details) || '';
  const message = FRIENDLY[code] || [err.message, details].filter(Boolean).join(': ') || `Meta error (HTTP ${status})`;
  const base = { error: message.slice(0, 300), error_code: code ? String(code) : String(status) };
  if (ABORT_CODES.has(code) || status === 401) return { ...base, outcome: 'requeue', abort: `Meta stopped sending: ${message}` };
  if (RETRY_CODES.has(code) || status === 429 || status >= 500) return { ...base, outcome: 'retry', retry_after: code === 130429 ? 60 : 300 };
  return { ...base, outcome: 'failed' };
}

async function sendOne(row, cfg, fetchFn) {
  let response;
  try {
    response = await fetchFn(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(row)),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    return { id: row.id, outcome: 'retry', error: 'Could not reach Meta, will try again', error_code: 'network', retry_after: 60 };
  }
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  const messageId = body && body.messages && body.messages[0] && body.messages[0].id;
  if (response.ok && messageId) return { id: row.id, outcome: 'sent', wa_message_id: messageId };
  return { id: row.id, ...classifyFailure(response.status, body) };
}

async function sendAll(rows, cfg, fetchFn) {
  const results = new Array(rows.length);
  let next = 0;
  let abort = null;
  async function worker() {
    while (next < rows.length) {
      const index = next;
      next += 1;
      // Once a stop-everything error is seen, put the rest back in the queue untouched.
      results[index] = abort ? { id: rows[index].id, outcome: 'requeue' } : await sendOne(rows[index], cfg, fetchFn);
      if (results[index].abort && !abort) abort = results[index].abort;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return { results, abort };
}

async function rpc(cfg, name, args, fetchFn) {
  const response = await fetchFn(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function handle(request, env, fetchFn = fetch) {
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const secret = env.get('WA_CRON_SECRET') || '';
  if (!secret || !safeEqual(request.headers.get('x-cron-secret') || '', secret)) return json({ error: 'Not allowed' }, 401);

  const cfg = {
    token: env.get('WA_ACCESS_TOKEN'),
    phoneId: env.get('WA_PHONE_NUMBER_ID'),
    version: env.get('WA_API_VERSION') || 'v23.0',
    supabaseUrl: (env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
    serviceKey: env.get('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const maxRunMs = Number(env.get('WA_MAX_RUN_MS')) || 100000;
  if (!cfg.supabaseUrl || !cfg.serviceKey) return json({ error: 'Supabase settings are missing' }, 500);
  const missing = ['token', 'phoneId'].filter(key => !cfg[key]).map(key => (key === 'token' ? 'WA_ACCESS_TOKEN' : 'WA_PHONE_NUMBER_ID'));
  if (missing.length) {
    const reason = `Missing secret in Supabase Edge Functions: ${missing.join(', ')}`;
    try { await rpc(cfg, 'wa_record_results', { p_results: [], p_abort: reason }, fetchFn); } catch { /* reported below */ }
    return json({ error: reason }, 500);
  }

  const started = Date.now();
  const totals = { sent: 0, failed: 0, retried: 0, requeued: 0, aborted: null };
  while (Date.now() - started < maxRunMs) {
    const rows = await rpc(cfg, 'wa_claim_batch', { p_limit: CLAIM_SIZE }, fetchFn);
    if (!rows || !rows.length) break;
    const { results, abort } = await sendAll(rows, cfg, fetchFn);
    await rpc(cfg, 'wa_record_results', { p_results: results, p_abort: abort }, fetchFn);
    for (const result of results) {
      if (result.outcome === 'sent') totals.sent += 1;
      else if (result.outcome === 'failed') totals.failed += 1;
      else if (result.outcome === 'retry') totals.retried += 1;
      else totals.requeued += 1;
    }
    if (abort) {
      totals.aborted = abort;
      break;
    }
  }
  return json(totals);
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(request => handle(request, { get: key => Deno.env.get(key) }));
}
