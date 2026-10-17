-- Refiners City Attendance — Supabase database setup
-- Run this whole file in Supabase: SQL Editor > New query > paste > Run.
-- It is safe to run again (for example after an app update): it only adds what is missing
-- and replaces functions and policies. Existing records and accounts are kept.

-- 1. Tables -----------------------------------------------------------------

-- One profile per login. Created automatically when someone signs up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'ordained' check (role in ('admin', 'ordained', 'g12', 'bishop')),
  class_name text not null default '',
  area_id text not null default '',
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- All church records (members, attendance, services, areas, ...).
-- "collection" says what kind of record it is; "data" holds the record itself.
create table if not exists public.records (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);

-- Deleted records are kept for a while as small "tombstones" so every device learns about
-- the deletion when it downloads only what changed. They are purged after 45 days.
alter table public.records add column if not exists deleted boolean not null default false;
-- Which device made the change, so a device can ignore the live echo of its own edits.
alter table public.records add column if not exists client_id text;
create index if not exists records_updated_at_idx on public.records (updated_at);

-- The server, not the phone's clock, decides when a record changed.
create or replace function public.touch_record()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  if new.deleted then
    new.data := '{}'::jsonb;
  end if;
  return new;
end
$$;

drop trigger if exists touch_record on public.records;
create trigger touch_record
  before insert or update on public.records
  for each row execute function public.touch_record();

-- 2. Helper functions ---------------------------------------------------------

-- Role of the signed-in user, or null if they are not signed in / not approved yet.
create or replace function public.app_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and approved
$$;

-- Which roles may change which kind of record.
create or replace function public.can_write_collection(target text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.app_role() is null then false
    when public.app_role() = 'admin' then true
    -- bishops add/edit members in their area; G12 pastors assign members to their class
    when target = 'members' then public.app_role() in ('bishop', 'g12')
    -- every approved user can add prospects and use the WhatsApp centre
    when target in ('prospects', 'messageRules', 'automationLog') then true
    -- attendance, services, areas, settings: Church Admin only
    else false
  end
$$;

-- 3. New sign-ups -------------------------------------------------------------
-- The very first account becomes the approved Church Admin.
-- Everyone after that gets the role they asked for (never admin) and waits for approval.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  is_first boolean;
  requested text := coalesce(new.raw_user_meta_data ->> 'role', 'ordained');
begin
  lock table public.profiles in share row exclusive mode;
  select not exists (select 1 from public.profiles where role = 'admin' and approved) into is_first;
  if requested not in ('ordained', 'g12', 'bishop') then
    requested := 'ordained';
  end if;
  insert into public.profiles (id, email, name, role, class_name, area_id, approved)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when is_first then 'admin' else requested end,
    coalesce(new.raw_user_meta_data ->> 'className', ''),
    coalesce(new.raw_user_meta_data ->> 'areaId', ''),
    is_first
  );
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins can change role / approval; nobody can remove the last approved admin.
-- (Changes typed in the Supabase SQL Editor have no signed-in user and are always allowed,
-- so the church can recover if it is ever locked out.)
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and public.app_role() is distinct from 'admin' then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  new.email := old.email;
  new.id := old.id;
  if old.role = 'admin' and old.approved and (new.role <> 'admin' or not new.approved)
     and not exists (select 1 from public.profiles where role = 'admin' and approved and id <> old.id) then
    raise exception 'The church must keep at least one approved Church Admin.';
  end if;
  return new;
end
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 4. Row level security -------------------------------------------------------
-- "(select ...)" makes Postgres check the user's role once per request instead of once per row.

alter table public.profiles enable row level security;
alter table public.records enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) is not null);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.app_role()) = 'admin')
  with check (id = (select auth.uid()) or (select public.app_role()) = 'admin');

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select public.app_role()) = 'admin' and id <> (select auth.uid()));

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using ((select public.app_role()) is not null);

-- Same rules as can_write_collection(), written inline so they stay cheap on big imports.
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    (select public.app_role()) = 'admin'
    or (collection = 'members' and (select public.app_role()) in ('bishop', 'g12'))
    or (collection in ('prospects', 'messageRules', 'automationLog') and (select public.app_role()) is not null)
  );

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    (select public.app_role()) = 'admin'
    or (collection = 'members' and (select public.app_role()) in ('bishop', 'g12'))
    or (collection in ('prospects', 'messageRules', 'automationLog') and (select public.app_role()) is not null)
  )
  with check (
    (select public.app_role()) = 'admin'
    or (collection = 'members' and (select public.app_role()) in ('bishop', 'g12'))
    or (collection in ('prospects', 'messageRules', 'automationLog') and (select public.app_role()) is not null)
  );

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using ((select public.app_role()) = 'admin');

revoke all on public.profiles, public.records from anon;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.records to authenticated;
-- Needed when "Automatically expose new tables" is turned off for the project.
grant usage on schema public to authenticated;
grant execute on function public.app_role() to authenticated;
grant execute on function public.can_write_collection(text) to authenticated;

-- 5. Housekeeping and usage (Church Admin only) -----------------------------------

-- Removes deletion tombstones older than 45 days. The app calls this when the admin signs in.
create or replace function public.purge_deleted_records()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  removed integer;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  delete from public.records where deleted and updated_at < now() - interval '45 days';
  get diagnostics removed = row_count;
  return removed;
end
$$;

-- Database size and record counts, shown on the Settings page.
create or replace function public.usage_summary()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'Only the Church Admin can do this.';
  end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'records_bytes', pg_total_relation_size('public.records'),
    'accounts', (select count(*) from public.profiles),
    'collections', coalesce((
      select jsonb_object_agg(collection, total)
      from (select collection, count(*) as total from public.records where not deleted group by collection) counts
    ), '{}'::jsonb),
    'tombstones', (select count(*) from public.records where deleted)
  );
end
$$;

-- The database's clock, so devices know exactly up to when they have downloaded changes.
create or replace function public.server_time()
returns timestamptz
language sql stable
as $$
  select now()
$$;

revoke all on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated;
revoke all on function public.purge_deleted_records() from public, anon;
revoke all on function public.usage_summary() from public, anon;
grant execute on function public.purge_deleted_records() to authenticated;
grant execute on function public.usage_summary() to authenticated;

-- 6. Live updates (other devices see changes immediately) ----------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.records;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end
$$;
