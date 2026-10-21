// @ts-nocheck
// wa-webhook: receives Meta's delivery reports (sent / delivered / read / failed) and replies.
// People who reply STOP are never messaged again.
// Settings (Supabase > Edge Functions > Secrets): WA_VERIFY_TOKEN, WA_APP_SECRET.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are added by Supabase.
// This function must be deployed WITHOUT "Verify JWT" (Meta cannot send one); the signature check below protects it.

const STOP_WORDS = /^\s*(stop|stop all|stop promotions|unsubscribe|cancel|opt[\s-]?out|remove me)\s*[.!]?\s*$/i;
const START_WORDS = /^\s*(start|subscribe|resume)\s*[.!]?\s*$/i;

function text(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureFor(secret, rawBody) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return 'sha256=' + Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function rpc(cfg, name, args, fetchFn) {
  const response = await fetchFn(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${body.slice(0, 200)}`);
  return body ? JSON.parse(body) : null;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function applyStatus(cfg, status, fetchFn, retryDelayMs) {
  const error = Array.isArray(status.errors) && status.errors[0] ? status.errors[0] : null;
  const args = {
    p_message_id: status.id,
    p_status: status.status,
    p_error: error ? [error.title, error.message, error.error_data && error.error_data.details].filter(Boolean).join(': ') : null,
    p_error_code: error && error.code ? String(error.code) : null,
    p_at: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString(),
  };
  const found = await rpc(cfg, 'wa_apply_status', args, fetchFn);
  // The report can arrive a moment before our own "sent" record is saved: try once more.
  if (found === false) {
    await wait(retryDelayMs);
    await rpc(cfg, 'wa_apply_status', args, fetchFn);
  }
}

function messageText(message) {
  if (message.type === 'text' && message.text) return message.text.body || '';
  if (message.type === 'button' && message.button) return message.button.text || '';
  if (message.type === 'interactive' && message.interactive && message.interactive.button_reply) return message.interactive.button_reply.title || '';
  return '';
}

export async function handle(request, env, fetchFn = fetch) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const verifyToken = env.get('WA_VERIFY_TOKEN') || '';
    if (verifyToken && url.searchParams.get('hub.mode') === 'subscribe' && safeEqual(url.searchParams.get('hub.verify_token') || '', verifyToken)) {
      return text(url.searchParams.get('hub.challenge') || '');
    }
    return text('Forbidden', 403);
  }
  if (request.method !== 'POST') return text('Use POST', 405);

  const raw = await request.text();
  const appSecret = env.get('WA_APP_SECRET') || '';
  const expected = appSecret ? await signatureFor(appSecret, raw) : '';
  if (!appSecret || !safeEqual(request.headers.get('x-hub-signature-256') || '', expected)) return text('Bad signature', 401);

  const cfg = {
    supabaseUrl: (env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
    serviceKey: env.get('SUPABASE_SERVICE_ROLE_KEY'),
  };
  const retryDelayMs = Number(env.get('WA_STATUS_RETRY_MS')) || 3000;
  let payload;
  try { payload = JSON.parse(raw); } catch { return text('ok'); }

  const work = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const status of value.statuses || []) {
        if (status.id && status.status) work.push(applyStatus(cfg, status, fetchFn, retryDelayMs));
      }
      for (const message of value.messages || []) {
        const body = messageText(message);
        if (STOP_WORDS.test(body)) work.push(rpc(cfg, 'wa_add_optout', { p_phone: message.from, p_reason: 'Replied STOP' }, fetchFn));
        else if (START_WORDS.test(body)) work.push(rpc(cfg, 'wa_remove_optout', { p_phone: message.from }, fetchFn));
      }
    }
  }
  // Always answer 200 so Meta does not keep re-sending; problems are logged for the Supabase logs.
  const outcomes = await Promise.allSettled(work);
  outcomes.forEach(outcome => { if (outcome.status === 'rejected') console.error('webhook work failed', String(outcome.reason)); });
  return text('ok');
}

if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(request => handle(request, { get: key => Deno.env.get(key) }));
}
