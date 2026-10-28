-- DriveDesk's shared copy in Supabase: the drives, who may sign in, and what each role may do.
-- Run it as the postgres user (Supabase SQL editor); it is safe to run again.
--
-- Roles live in each account's app_metadata (only this file's functions and the dashboard can set it):
--   admin  : everything, including the accounts
--   senior : creates, edits and deletes drives, approves volunteers
--   junior : reads every drive, asks to volunteer; edits only the drives they volunteer at
-- Accounts are username@drivedesk.local; a drive's volunteers (phases[].crew) are usernames.

create table if not exists public.drives (
  id text primary key,
  data jsonb not null,
  company text generated always as (data->>'company') stored,
  date text generated always as (data->>'date') stored,
  status text generated always as (data->>'status') stored,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.drives enable row level security;
grant select, insert, update, delete on public.drives to authenticated;
-- removing an account keeps the drives it created
alter table public.drives drop constraint if exists drives_updated_by_fkey;
alter table public.drives add constraint drives_updated_by_fkey foreign key (updated_by) references auth.users on delete set null;

-- The signed-in member's role and username, read from their account on every request (not from the sign-in token,
-- which can be an hour old), so a removed account or a changed role counts at once. Null for anyone else, such as an
-- account made through Supabase's own sign-up: they see nothing.
create or replace function public.desk_role() returns text language sql stable security definer set search_path = '' as $$
  select raw_app_meta_data->>'role' from auth.users
  where id = auth.uid() and raw_app_meta_data->>'role' in ('admin', 'senior', 'junior')
$$;
create or replace function public.desk_user() returns text language sql stable security definer set search_path = '' as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid() and email like '%@drivedesk.local'
$$;
-- volunteers at any phase of this drive
create or replace function public.desk_on_crew(d jsonb) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from jsonb_array_elements(coalesce(d->'phases', '[]')) p where coalesce(p->'crew', '[]') ? public.desk_user())
$$;

drop policy if exists "committee reads drives" on public.drives;
drop policy if exists "committee adds drives" on public.drives;
drop policy if exists "committee edits drives" on public.drives;
drop policy if exists "committee deletes drives" on public.drives;
drop policy if exists "members read drives" on public.drives;
drop policy if exists "seniors add drives" on public.drives;
drop policy if exists "seniors and volunteers edit drives" on public.drives;
drop policy if exists "seniors delete drives" on public.drives;
create policy "members read drives" on public.drives for select to authenticated
  using ((select public.desk_role()) is not null);
create policy "seniors add drives" on public.drives for insert to authenticated
  with check ((select public.desk_role()) in ('admin', 'senior'));
create policy "seniors and volunteers edit drives" on public.drives for update to authenticated
  using ((select public.desk_role()) in ('admin', 'senior') or ((select public.desk_role()) = 'junior' and public.desk_on_crew(data)))
  with check ((select public.desk_role()) in ('admin', 'senior') or ((select public.desk_role()) = 'junior' and public.desk_on_crew(data)));
create policy "seniors delete drives" on public.drives for delete to authenticated
  using ((select public.desk_role()) in ('admin', 'senior'));

-- A member asking to volunteer at one phase of a drive. Approving adds them to that phase's volunteers (in the drive)
-- and marks the request; seniors see every request, juniors their own.
create table if not exists public.volunteer_requests (
  drive_id text not null references public.drives on delete cascade,
  phase text not null check (phase in ('ppt', 'oa', 'int')),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  username text not null default public.desk_user(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  asked_at timestamptz not null default now(),
  decided_by text,
  primary key (drive_id, phase, user_id)
);
alter table public.volunteer_requests enable row level security;
grant select, insert, update, delete on public.volunteer_requests to authenticated;
drop policy if exists "own or seniors read requests" on public.volunteer_requests;
drop policy if exists "members ask to volunteer" on public.volunteer_requests;
drop policy if exists "members ask again" on public.volunteer_requests;
drop policy if exists "seniors decide requests" on public.volunteer_requests;
drop policy if exists "withdraw or clear requests" on public.volunteer_requests;
create policy "own or seniors read requests" on public.volunteer_requests for select to authenticated
  using (user_id = auth.uid() or (select public.desk_role()) in ('admin', 'senior'));
create policy "members ask to volunteer" on public.volunteer_requests for insert to authenticated
  with check (user_id = auth.uid() and username = (select public.desk_user()) and status = 'pending' and (select public.desk_role()) is not null);
create policy "members ask again" on public.volunteer_requests for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and status = 'pending');
create policy "seniors decide requests" on public.volunteer_requests for update to authenticated
  using ((select public.desk_role()) in ('admin', 'senior')) with check ((select public.desk_role()) in ('admin', 'senior'));
create policy "withdraw or clear requests" on public.volunteer_requests for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or (select public.desk_role()) in ('admin', 'senior'));

-- Accounts, from the app's Accounts page (admin only). Everyone signed in can list the members, to show volunteers'
-- names; only the admin sees when each last signed in.
create or replace function public.desk_members()
returns table (id uuid, username text, name text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, split_part(u.email, '@', 1), coalesce(u.raw_app_meta_data->>'name', split_part(u.email, '@', 1)), u.raw_app_meta_data->>'role',
    u.created_at, case when public.desk_role() = 'admin' then u.last_sign_in_at end
  from auth.users u
  where public.desk_role() is not null and u.email like '%@drivedesk.local' and u.raw_app_meta_data->>'role' in ('admin', 'senior', 'junior')
  order by 3
$$;

create or replace function public.desk_add_member(p_username text, p_name text, p_role text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_user text := lower(trim(p_username));
  v_email text := lower(trim(p_username)) || '@drivedesk.local';
begin
  if public.desk_role() is distinct from 'admin' then raise exception 'Only the admin account can add members'; end if;
  if v_user !~ '^[a-z0-9][a-z0-9._-]{1,31}$' then raise exception 'A username is 2 to 32 lowercase letters, numbers, dots or dashes'; end if;
  if p_role not in ('junior', 'senior') then raise exception 'Pick junior or senior'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter their name'; end if;
  if length(p_password) < 8 then raise exception 'A password needs at least 8 characters'; end if;
  if exists (select 1 from auth.users where email = v_email) then raise exception 'The username % is already taken', v_user; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', p_role, 'name', left(trim(p_name), 80)), '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now());
  return v_id;
end $$;

-- a new password signs the member out everywhere: they sign in again with it
create or replace function public.desk_set_password(p_id uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.desk_role() is distinct from 'admin' then raise exception 'Only the admin account can reset passwords'; end if;
  if length(p_password) < 8 then raise exception 'A password needs at least 8 characters'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_id and raw_app_meta_data->>'role' in ('junior', 'senior');
  if not found then raise exception 'Member not found'; end if;
  delete from auth.sessions where user_id = p_id;
end $$;

create or replace function public.desk_remove_member(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.desk_role() is distinct from 'admin' then raise exception 'Only the admin account can remove members'; end if;
  delete from auth.users where id = p_id and raw_app_meta_data->>'role' in ('junior', 'senior');
  if not found then raise exception 'Member not found'; end if;
end $$;

revoke all on function public.desk_role(), public.desk_user(), public.desk_on_crew(jsonb), public.desk_members(),
  public.desk_add_member(text, text, text, text), public.desk_set_password(uuid, text), public.desk_remove_member(uuid) from public, anon;
grant execute on function public.desk_role(), public.desk_user(), public.desk_on_crew(jsonb), public.desk_members(),
  public.desk_add_member(text, text, text, text), public.desk_set_password(uuid, text), public.desk_remove_member(uuid) to authenticated;

-- the committee's original account is the admin
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role": "admin", "name": "PCOM"}'
where email = 'pcom@drivedesk.local' and raw_app_meta_data->>'role' is null;
