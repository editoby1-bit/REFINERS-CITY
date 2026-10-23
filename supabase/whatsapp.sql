-- Refiners City — automatic WhatsApp sending (WhatsApp Business Cloud API)
-- Run AFTER supabase/setup.sql: SQL Editor > New query > paste > Run. Safe to run again.
-- Setup steps are in WHATSAPP_SETUP.md.
--
-- How it works: the app (admin only) puts messages in a queue (wa_outbox). A background function
-- (supabase/functions/wa-send) sends them through Meta, a few every second, and Meta's delivery
-- reports (supabase/functions/wa-webhook) update each row: sent > delivered > read, or failed.

-- 1. Tables -------------------------------------------------------------------

-- Single settings row. "daily_limit" is how many different people Meta lets this number message
-- in 24 hours (250 at first, 1,000 once the business is verified, then higher as you send).
create table if not exists public.wa_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  paused boolean not null default false,
  daily_limit int not null default 250 check (daily_limit between 1 and 1000000),
  default_country_code text not null default '234',
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.wa_settings (id) values (1) on conflict (id) do nothing;

-- Where the database should call the sender, and the shared secret. Never readable from the app.
create table if not exists public.wa_private (
  id int primary key default 1 check (id = 1),
  function_url text,
  cron_secret text
);
insert into public.wa_private (id) values (1) on conflict (id) do nothing;

-- Message templates that Meta has approved. The name and language must match Meta exactly.
-- "variables" lists what fills {{1}}, {{2}}, ... in order: name, first_name, area, service, date.
create table if not exists public.wa_templates (
  id text primary key,
  name text not null,
  language text not null default 'en',
  label text not null default '',
  purpose text not null default 'custom' check (purpose in ('birthday', 'absentee', 'holiday', 'announcement', 'welcome', 'custom')),
  body text not null default '',
  variables jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_outbox (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  kind text not null default 'manual',
  recipient_type text not null default 'member',
  recipient_id text not null default '',
  recipient_name text not null default '',
  phone text not null default '',
  template_name text not null,
  language text not null default 'en',
  params jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  error text,
  error_code text,
  wa_message_id text,
  attempts int not null default 0,
  scheduled_for timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz
);
create index if not exists wa_outbox_queue_idx on public.wa_outbox (status, scheduled_for) where status in ('queued', 'sending');
create index if not exists wa_outbox_batch_idx on public.wa_outbox (batch_id);
create index if not exists wa_outbox_message_idx on public.wa_outbox (wa_message_id) where wa_message_id is not null;
create index if not exists wa_outbox_recent_idx on public.wa_outbox (phone, template_name, created_at desc);

-- People who replied STOP (or were added by the admin). They are never messaged.
create table if not exists public.wa_optouts (
  phone text primary key,
  reason text not null default '',
  created_at timestamptz not null default now()
);

-- 2. Phone numbers --------------------------------------------------------------
-- 08030000001 / +234 803 000 0001 / 8030000001 all become 2348030000001.
-- Returns null when the number cannot be valid. Keep in step with normalizePhone() in app.js.
create or replace function public.wa_normalize_phone(p_phone text, p_country text default '234')
returns text
language plpgsql immutable
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  cc text := regexp_replace(coalesce(p_country, '234'), '\D', '', 'g');
begin
  if digits = '' then return null; end if;
  if left(digits, 2) = '00' then
    digits := substr(digits, 3);
  elsif left(digits, 1) = '0' then
    digits := cc || substr(digits, 2);
  elsif length(digits) <= 10 then
    digits := cc || digits;
  end if;
  if left(digits, length(cc) + 1) = cc || '0' then
    digits := cc || substr(digits, length(cc) + 2);
  end if;
  if length(digits) < 11 or length(digits) > 15 then return null; end if;
  if cc = '234' and left(digits, 3) = '234' and length(digits) <> 13 then return null; end if;
  return digits;
end
$$;

-- 3. Row level security ------------------------------------------------------------
alter table public.wa_settings enable row level security;
alter table public.wa_private enable row level security;
alter table public.wa_templates enable row level security;
alter table public.wa_outbox enable row level security;
alter table public.wa_optouts enable row level security;

drop policy if exists wa_settings_select on public.wa_settings;
create policy wa_settings_select on public.wa_settings for select to authenticated
  using ((select public.app_role()) is not null);

drop policy if exists wa_templates_select on public.wa_templates;
create policy wa_templates_select on public.wa_templates for select to authenticated
  using ((select public.app_role()) is not null);
drop policy if exists wa_templates_write on public.wa_templates;
create policy wa_templates_write on public.wa_templates for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

drop policy if exists wa_outbox_select on public.wa_outbox;
create policy wa_outbox_select on public.wa_outbox for select to authenticated
  using ((select public.app_role()) = 'admin');

drop policy if exists wa_optouts_select on public.wa_optouts;
create policy wa_optouts_select on public.wa_optouts for select to authenticated
  using ((select public.app_role()) = 'admin');

revoke all on public.wa_settings, public.wa_private, public.wa_templates, public.wa_outbox, public.wa_optouts from anon, authenticated;
grant select on public.wa_settings, public.wa_outbox, public.wa_optouts to authenticated;
grant select, insert, update, delete on public.wa_templates to authenticated;

-- 4. Queueing ----------------------------------------------------------------------

-- Shared by the admin's "Send" button and the daily rules. p_rows is a JSON list of
-- {recipient_type, recipient_id, name, phone, params:[...]}.
create or replace function public.wa_enqueue_rows(
  p_kind text, p_template text, p_language text, p_rows jsonb, p_scheduled timestamptz, p_user uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  cc text;
  batch uuid := gen_random_uuid();
  queued int := 0;
  no_phone int := 0;
  optout int := 0;
  dup int := 0;
  item jsonb;
  v_phone text;
  seen text[] := '{}';
begin
  select default_country_code into cc from public.wa_settings where id = 1;
  for item in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_phone := public.wa_normalize_phone(item ->> 'phone', cc);
    if v_phone is null then
      no_phone := no_phone + 1;
      insert into public.wa_outbox (batch_id, kind, recipient_type, recipient_id, recipient_name, phone, template_name, language, params, status, error, scheduled_for, created_by)
      values (batch, p_kind, coalesce(item ->> 'recipient_type', 'member'), coalesce(item ->> 'recipient_id', ''), coalesce(item ->> 'name', ''), coalesce(item ->> 'phone', ''), p_template, p_language, coalesce(item -> 'params', '[]'::jsonb), 'skipped', 'No valid phone number', p_scheduled, p_user);
    elsif v_phone = any (seen) then
      dup := dup + 1;
    elsif exists (select 1 from public.wa_optouts where wa_optouts.phone = v_phone) then
      optout := optout + 1;
      seen := seen || v_phone;
      insert into public.wa_outbox (batch_id, kind, recipient_type, recipient_id, recipient_name, phone, template_name, language, params, status, error, scheduled_for, created_by)
      values (batch, p_kind, coalesce(item ->> 'recipient_type', 'member'), coalesce(item ->> 'recipient_id', ''), coalesce(item ->> 'name', ''), v_phone, p_template, p_language, coalesce(item -> 'params', '[]'::jsonb), 'skipped', 'Recipient opted out', p_scheduled, p_user);
    elsif p_kind <> 'test' and exists (
      select 1 from public.wa_outbox o
      where o.phone = v_phone and o.template_name = p_template
        and o.status in ('queued', 'sending', 'sent', 'delivered', 'read')
        and o.created_at > now() - interval '20 hours'
    ) then
      -- Same person, same message, within 20 hours: protects against double clicks and double runs.
      dup := dup + 1;
      seen := seen || v_phone;
    else
      seen := seen || v_phone;
      queued := queued + 1;
      insert into public.wa_outbox (batch_id, kind, recipient_type, recipient_id, recipient_name, phone, template_name, language, params, scheduled_for, created_by)
      values (batch, p_kind, coalesce(item ->> 'recipient_type', 'member'), coalesce(item ->> 'recipient_id', ''), coalesce(item ->> 'name', ''), v_phone, p_template, p_language, coalesce(item -> 'params', '[]'::jsonb), p_scheduled, p_user);
    end if;
  end loop;
  if queued > 0 then
    perform public.wa_poke();
  end if;
  return jsonb_build_object('batch_id', batch, 'queued', queued, 'no_phone', no_phone, 'opted_out', optout, 'duplicates', dup);
end
$$;

-- The admin's "send" button.
create or replace function public.wa_enqueue(
  p_kind text, p_template text, p_language text, p_rows jsonb, p_scheduled timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  settings public.wa_settings;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can send WhatsApp messages.';
  end if;
  select * into settings from public.wa_settings where id = 1;
  if not settings.enabled then
    raise exception 'Automatic WhatsApp sending is switched off. Turn it on in the WhatsApp Centre first.';
  end if;
  if not exists (select 1 from public.wa_templates where name = p_template and language = p_language and active) then
    raise exception 'Unknown or switched-off template "%".', p_template;
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 20000 then
    raise exception 'Too many recipients in one send (limit 20,000).';
  end if;
  return public.wa_enqueue_rows(coalesce(nullif(p_kind, ''), 'manual'), p_template, p_language, p_rows, coalesce(p_scheduled, now()), auth.uid());
end
$$;

-- 5. Sending (called only by the wa-send function) --------------------------------------

-- Hands out the next messages to send, never more than the daily limit of different people.
create or replace function public.wa_claim_batch(p_limit int)
returns setof public.wa_outbox
language plpgsql security definer set search_path = public
as $$
declare
  settings public.wa_settings;
  remaining int;
  take int;
begin
  perform pg_advisory_xact_lock(7650001);
  select * into settings from public.wa_settings where id = 1;
  if not settings.enabled or settings.paused then return; end if;

  -- A send that never reported back (function stopped midway): try again, or give up after 3 tries.
  update public.wa_outbox set status = 'queued', updated_at = now()
    where status = 'sending' and updated_at < now() - interval '10 minutes' and attempts < 3;
  update public.wa_outbox set status = 'failed', error = 'Sending was interrupted', updated_at = now()
    where status = 'sending' and updated_at < now() - interval '10 minutes' and attempts >= 3;
  update public.wa_outbox o set status = 'skipped', error = 'Recipient opted out', updated_at = now()
    where o.status = 'queued' and exists (select 1 from public.wa_optouts x where x.phone = o.phone);

  select settings.daily_limit - count(distinct phone) into remaining
    from public.wa_outbox
    where status in ('sending', 'sent', 'delivered', 'read') and coalesce(sent_at, updated_at) > now() - interval '24 hours';
  take := least(greatest(coalesce(p_limit, 0), 0), greatest(remaining, 0));
  if take <= 0 then return; end if;

  return query
    with next as (
      select id from public.wa_outbox
      where status = 'queued' and scheduled_for <= now()
      order by scheduled_for, created_at
      limit take
      for update skip locked
    ), claimed as (
      update public.wa_outbox o
        set status = 'sending', attempts = o.attempts + 1, updated_at = now()
        from next
        where o.id = next.id
        returning o.*
    )
    select * from claimed;
end
$$;

-- p_results: [{id, outcome: sent|failed|retry|requeue, wa_message_id, error, error_code, retry_after}]
-- p_abort: a reason when the whole run was stopped (for example the access token is invalid).
create or replace function public.wa_record_results(p_results jsonb, p_abort text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r jsonb;
  any_sent boolean := false;
begin
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    case r ->> 'outcome'
      when 'sent' then
        any_sent := true;
        update public.wa_outbox set status = 'sent', wa_message_id = r ->> 'wa_message_id', sent_at = now(), updated_at = now(), error = null, error_code = null
          where id = (r ->> 'id')::uuid;
      when 'failed' then
        update public.wa_outbox set status = 'failed', error = left(r ->> 'error', 500), error_code = r ->> 'error_code', updated_at = now()
          where id = (r ->> 'id')::uuid;
      when 'retry' then
        update public.wa_outbox set
            status = case when attempts >= 3 then 'failed' else 'queued' end,
            error = left(r ->> 'error', 500), error_code = r ->> 'error_code',
            scheduled_for = now() + make_interval(secs => coalesce((r ->> 'retry_after')::int, 60)),
            updated_at = now()
          where id = (r ->> 'id')::uuid;
      when 'requeue' then
        update public.wa_outbox set status = 'queued', attempts = greatest(attempts - 1, 0), updated_at = now()
          where id = (r ->> 'id')::uuid and status = 'sending';
      else null;
    end case;
  end loop;
  if p_abort is not null then
    -- Stop sending until the admin has fixed the problem and pressed Resume.
    update public.wa_settings set last_error = left(p_abort, 500), last_error_at = now(), paused = true where id = 1;
  elsif any_sent then
    update public.wa_settings set last_error = null, last_error_at = null where id = 1 and last_error is not null;
  end if;
end
$$;

-- Meta's delivery reports. Never moves a message backwards (read > delivered > sent).
create or replace function public.wa_apply_status(
  p_message_id text, p_status text, p_error text default null, p_error_code text default null, p_at timestamptz default now()
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  n_rows int;
begin
  if p_status = 'failed' then
    update public.wa_outbox set status = 'failed', error = left(coalesce(p_error, 'Delivery failed'), 500), error_code = p_error_code, updated_at = now()
      where wa_message_id = p_message_id and status in ('sent', 'sending', 'delivered');
  elsif p_status = 'delivered' then
    update public.wa_outbox set status = case when status = 'read' then 'read' else 'delivered' end,
        delivered_at = coalesce(delivered_at, p_at), updated_at = now()
      where wa_message_id = p_message_id and status in ('sent', 'sending', 'delivered', 'read');
  elsif p_status = 'read' then
    update public.wa_outbox set status = 'read', delivered_at = coalesce(delivered_at, p_at), read_at = coalesce(read_at, p_at), updated_at = now()
      where wa_message_id = p_message_id and status in ('sent', 'sending', 'delivered', 'read');
  elsif p_status = 'sent' then
    update public.wa_outbox set updated_at = now() where wa_message_id = p_message_id;
  end if;
  get diagnostics n_rows = row_count;
  if n_rows = 0 then
    return exists (select 1 from public.wa_outbox where wa_message_id = p_message_id);
  end if;
  return true;
end
$$;

create or replace function public.wa_add_optout(p_phone text, p_reason text default '')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_phone text := public.wa_normalize_phone(p_phone, (select default_country_code from public.wa_settings where id = 1));
begin
  if v_phone is null then v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'); end if;
  if v_phone = '' then return; end if;
  insert into public.wa_optouts (phone, reason) values (v_phone, left(coalesce(p_reason, ''), 200)) on conflict (phone) do nothing;
  update public.wa_outbox set status = 'skipped', error = 'Recipient opted out', updated_at = now() where wa_outbox.phone = v_phone and status = 'queued';
end
$$;

create or replace function public.wa_remove_optout(p_phone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.wa_optouts
    where phone = coalesce(
      public.wa_normalize_phone(p_phone, (select default_country_code from public.wa_settings where id = 1)),
      regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'));
end
$$;

-- The admin can add a number by hand, or restore one after a mistaken STOP.
create or replace function public.wa_admin_optout(p_phone text, p_add boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  if p_add then
    perform public.wa_add_optout(p_phone, 'Added by admin');
  else
    perform public.wa_remove_optout(p_phone);
  end if;
end
$$;

-- 6. Admin controls -------------------------------------------------------------------

create or replace function public.wa_update_settings(
  p_enabled boolean, p_paused boolean, p_daily_limit int, p_country_code text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can change WhatsApp settings.';
  end if;
  update public.wa_settings set
    enabled = coalesce(p_enabled, enabled),
    paused = coalesce(p_paused, paused),
    daily_limit = coalesce(p_daily_limit, daily_limit),
    default_country_code = coalesce(nullif(regexp_replace(coalesce(p_country_code, ''), '\D', '', 'g'), ''), default_country_code),
    -- Pressing Resume also clears the "sending stopped" message.
    last_error = case when p_paused is false then null else last_error end,
    last_error_at = case when p_paused is false then null else last_error_at end,
    updated_at = now()
  where id = 1;
  if coalesce(p_enabled, false) then perform public.wa_poke(); end if;
end
$$;

create or replace function public.wa_retry_failed(p_batch uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  update public.wa_outbox set status = 'queued', attempts = 0, error = null, error_code = null, scheduled_for = now(), updated_at = now()
    where status = 'failed' and (p_batch is null or batch_id = p_batch);
  get diagnostics n = row_count;
  if n > 0 then perform public.wa_poke(); end if;
  return n;
end
$$;

create or replace function public.wa_cancel_queued(p_batch uuid default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  update public.wa_outbox set status = 'skipped', error = 'Cancelled by admin', updated_at = now()
    where status = 'queued' and (p_batch is null or batch_id = p_batch);
  get diagnostics n = row_count;
  return n;
end
$$;

-- Recent sends, one line per batch, with a count for each status.
create or replace function public.wa_batch_summary()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  return coalesce((
    select jsonb_agg(b order by b.created_at desc) from (
      select batch_id,
             min(kind) as kind,
             min(template_name) as template_name,
             min(created_at) as created_at,
             count(*) as total,
             count(*) filter (where status = 'queued') as queued,
             count(*) filter (where status = 'sending') as sending,
             count(*) filter (where status = 'sent') as sent,
             count(*) filter (where status = 'delivered') as delivered,
             count(*) filter (where status = 'read') as read,
             count(*) filter (where status = 'failed') as failed,
             count(*) filter (where status = 'skipped') as skipped
      from public.wa_outbox
      where created_at > now() - interval '60 days'
      group by batch_id
      order by min(created_at) desc
      limit 40
    ) b
  ), '[]'::jsonb);
end
$$;

-- How many different people were messaged in the last 24 hours (against the daily limit).
create or replace function public.wa_today_count()
returns int
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.app_role() is null then
    raise exception 'Not allowed.';
  end if;
  return (select count(distinct phone) from public.wa_outbox
          where status in ('sending', 'sent', 'delivered', 'read') and coalesce(sent_at, updated_at) > now() - interval '24 hours');
end
$$;

-- 7. Daily rules: birthdays, holidays and scheduled messages (runs by itself at 08:00 Lagos time) -----

create or replace function public.wa_easter(p_year int)
returns date
language plpgsql immutable
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  month int := (h + l - 7 * m + 114) / 31;
  day int := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, month, day);
end
$$;

-- A month-day in a given year; 29 February becomes 28 February in other years.
create or replace function public.wa_month_day(p_year int, p_date text)
returns date
language plpgsql immutable
as $$
declare
  m int := substr(p_date, 6, 2)::int;
  d int := substr(p_date, 9, 2)::int;
begin
  if m = 2 and d = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0)) then d := 28; end if;
  return make_date(p_year, m, d);
exception when others then
  return null;
end
$$;

-- Fills the template's {{1}}, {{2}}, ... for a person. Returns null if the template needs something
-- a daily rule cannot know (service or date).
create or replace function public.wa_rule_params(p_variables jsonb, p_name text, p_area text)
returns jsonb
language plpgsql immutable
as $$
declare
  v text;
  out jsonb := '[]'::jsonb;
  nm text := coalesce(nullif(btrim(p_name), ''), 'Friend');
begin
  for v in select jsonb_array_elements_text(coalesce(p_variables, '[]'::jsonb)) loop
    if v = 'name' then out := out || to_jsonb(nm);
    elsif v = 'first_name' then out := out || to_jsonb(split_part(nm, ' ', 1));
    elsif v = 'area' then out := out || to_jsonb(coalesce(nullif(btrim(p_area), ''), 'Refiners City'));
    else return null;
    end if;
  end loop;
  return out;
end
$$;

create or replace function public.wa_enqueue_due_rules()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Africa/Lagos')::date;
  md text := to_char((now() at time zone 'Africa/Lagos')::date, 'MM-DD');
  rule record;
  tpl public.wa_templates;
  token text;
  due boolean;
  target date;
  rows jsonb;
  res jsonb;
  ran int := 0;
  total int := 0;
begin
  if not exists (select 1 from public.wa_settings where id = 1 and enabled and not paused) then
    return jsonb_build_object('rules_run', 0, 'queued', 0);
  end if;

  for rule in
    select id, data from public.records
    where collection = 'messageRules' and not deleted and coalesce(data ->> 'templateName', '') <> ''
  loop
    token := rule.id || '_' || today::text;
    if exists (select 1 from public.records where collection = 'automationLog' and id = token and not deleted) then
      continue;
    end if;
    select * into tpl from public.wa_templates
      where name = rule.data ->> 'templateName' and active
      order by (language = coalesce(rule.data ->> 'templateLanguage', 'en')) desc limit 1;
    if not found then continue; end if;

    due := false;
    if rule.data ->> 'type' = 'birthday' then
      due := true; -- decided per person below
    elsif rule.data ->> 'type' = 'holiday' then
      if lower(coalesce(rule.data ->> 'title', '')) like '%easter%' then
        target := public.wa_easter(extract(year from today)::int);
      elsif coalesce((rule.data ->> 'yearly')::boolean, false) and coalesce(rule.data ->> 'scheduleDate', '') <> '' then
        target := public.wa_month_day(extract(year from today)::int, rule.data ->> 'scheduleDate');
      else
        target := nullif(rule.data ->> 'scheduleDate', '')::date;
      end if;
      due := target = today;
    elsif rule.data ->> 'type' = 'scheduled' then
      if coalesce(rule.data ->> 'scheduleDate', '') = '' then
        due := false;
      elsif coalesce((rule.data ->> 'yearly')::boolean, false) then
        due := public.wa_month_day(extract(year from today)::int, rule.data ->> 'scheduleDate') = today;
      else
        due := (rule.data ->> 'scheduleDate')::date = today;
      end if;
    end if;
    if not due then continue; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'recipient_type', a.kind, 'recipient_id', a.id, 'name', a.name, 'phone', a.phone,
             'params', public.wa_rule_params(tpl.variables, a.name, a.area_name))), '[]'::jsonb)
      into rows
      from (
        select 'member' as kind, m.id, m.data ->> 'fullName' as name, m.data ->> 'phone' as phone, m.data ->> 'birthday' as birthday,
               ar.data ->> 'name' as area_name, m.data ->> 'areaId' as area_id, m.data ->> 'g12PastorId' as g12_id
          from public.records m left join public.records ar on ar.collection = 'areas' and ar.id = m.data ->> 'areaId' and not ar.deleted
          where m.collection = 'members' and not m.deleted
        union all
        select 'prospect', p.id, p.data ->> 'fullName', p.data ->> 'phone', p.data ->> 'birthday',
               ar.data ->> 'name', p.data ->> 'areaId', ''
          from public.records p left join public.records ar on ar.collection = 'areas' and ar.id = p.data ->> 'areaId' and not ar.deleted
          where p.collection = 'prospects' and not p.deleted
      ) a
      where (
          case rule.data ->> 'audienceType'
            when 'everyone' then a.kind = 'member'
            when 'birthdays_today' then a.kind = 'member'
            when 'all_prospects' then a.kind = 'prospect'
            when 'area' then a.kind = 'member' and a.area_id = rule.data ->> 'audienceId'
            when 'g12' then a.kind = 'member' and a.g12_id = rule.data ->> 'audienceId'
            when 'single_member' then a.kind = 'member' and a.id = rule.data ->> 'audienceId'
            when 'single_prospect' then a.kind = 'prospect' and a.id = rule.data ->> 'audienceId'
            when 'selected_members' then a.kind = 'member' and (rule.data -> 'selectedIds') ? a.id
            when 'selected_prospects' then a.kind = 'prospect' and (rule.data -> 'selectedIds') ? a.id
            else false
          end
        )
        and (rule.data ->> 'type' <> 'birthday' or substr(coalesce(a.birthday, ''), 6) = md)
        and public.wa_rule_params(tpl.variables, a.name, a.area_name) is not null;

    if jsonb_array_length(rows) > 0 then
      res := public.wa_enqueue_rows('rule', tpl.name, tpl.language, rows, now(), null);
      total := total + (res ->> 'queued')::int;
      ran := ran + 1;
      -- The same marker the app uses, so the app also knows this rule has run today.
      insert into public.records (collection, id, data) values ('automationLog', token, jsonb_build_object('token', token))
        on conflict (collection, id) do update set deleted = false, data = excluded.data;
    end if;
  end loop;
  return jsonb_build_object('rules_run', ran, 'queued', total);
end
$$;

-- 8. Calling the sender ------------------------------------------------------------------

-- Tells the sender function there is work. Needs the pg_net extension and wa_configure() (see setup guide).
create or replace function public.wa_poke()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  u text;
  s text;
begin
  select function_url, cron_secret into u, s from public.wa_private where id = 1;
  if u is null or s is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  begin
    execute format(
      'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', ''x-cron-secret'', %L), body := ''{}''::jsonb, timeout_milliseconds := 5000)',
      u, s);
  exception when others then
    null; -- the minute-by-minute check below will try again
  end;
end
$$;

-- Runs every minute: wake the sender if anything is waiting. Also tidies old records once a day.
create or replace function public.wa_tick()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.wa_settings where id = 1 and enabled and not paused)
     and exists (select 1 from public.wa_outbox where status in ('queued', 'sending') and scheduled_for <= now()) then
    perform public.wa_poke();
  end if;
end
$$;

create or replace function public.wa_purge_old()
returns void
language sql security definer set search_path = public
as $$
  delete from public.wa_outbox where created_at < now() - interval '180 days';
$$;

-- Run once in the SQL Editor (never from the app): select public.wa_configure('https://<project>.supabase.co/functions/v1/wa-send', '<secret>');
create or replace function public.wa_configure(p_url text, p_secret text)
returns void
language sql security definer set search_path = public
as $$
  update public.wa_private set function_url = p_url, cron_secret = p_secret where id = 1;
$$;

-- 9. Who may call what -------------------------------------------------------------------

revoke all on function
  public.wa_enqueue_rows(text, text, text, jsonb, timestamptz, uuid),
  public.wa_claim_batch(int),
  public.wa_record_results(jsonb, text),
  public.wa_apply_status(text, text, text, text, timestamptz),
  public.wa_add_optout(text, text),
  public.wa_remove_optout(text),
  public.wa_enqueue_due_rules(),
  public.wa_poke(),
  public.wa_tick(),
  public.wa_purge_old(),
  public.wa_configure(text, text)
  from public, anon, authenticated;

revoke all on function
  public.wa_enqueue(text, text, text, jsonb, timestamptz),
  public.wa_admin_optout(text, boolean),
  public.wa_update_settings(boolean, boolean, int, text),
  public.wa_retry_failed(uuid),
  public.wa_cancel_queued(uuid),
  public.wa_batch_summary(),
  public.wa_today_count()
  from public, anon;

grant execute on function
  public.wa_enqueue(text, text, text, jsonb, timestamptz),
  public.wa_admin_optout(text, boolean),
  public.wa_update_settings(boolean, boolean, int, text),
  public.wa_retry_failed(uuid),
  public.wa_cancel_queued(uuid),
  public.wa_batch_summary(),
  public.wa_today_count()
  to authenticated;

-- The sender function runs with the project's service key.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant execute on function
      public.wa_claim_batch(int),
      public.wa_record_results(jsonb, text),
      public.wa_apply_status(text, text, text, text, timestamptz),
      public.wa_add_optout(text, text),
      public.wa_remove_optout(text)
      to service_role;
  end if;
end
$$;

-- 10. Automatic schedule (needs the pg_cron extension: Database > Extensions) -----------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wa-tick', '* * * * *', 'select public.wa_tick()');
    perform cron.schedule('wa-daily-rules', '0 7 * * *', 'select public.wa_enqueue_due_rules()');
    perform cron.schedule('wa-purge-old', '30 3 * * *', 'select public.wa_purge_old()');
  else
    raise notice 'pg_cron is not enabled yet: turn it on under Database > Extensions, then run this file again.';
  end if;
end
$$;
