-- Refiners City Attendance — Supabase database setup
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- It is safe to run again later (it only creates what is missing / replaces functions and policies).

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
create or replace function public.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.app_role() is distinct from 'admin' then
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

alter table public.profiles enable row level security;
alter table public.records enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() is not null);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.app_role() = 'admin')
  with check (id = auth.uid() or public.app_role() = 'admin');

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.app_role() = 'admin' and id <> auth.uid());

drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (public.app_role() is not null);

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (public.can_write_collection(collection));

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.can_write_collection(collection))
  with check (public.can_write_collection(collection));

drop policy if exists records_delete on public.records;
create policy records_delete on public.records for delete to authenticated
  using (public.can_write_collection(collection));

revoke all on public.profiles, public.records from anon;
grant select, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.records to authenticated;

-- 5. Live updates (other devices see changes immediately) ----------------------
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
