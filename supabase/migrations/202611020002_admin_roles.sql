-- Role-based access for the static Supabase-backed account and admin pages.
alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end;
$$;

create or replace function public.vozia_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

revoke all on function public.vozia_is_admin() from public;
grant execute on function public.vozia_is_admin() to authenticated;

create or replace function public.vozia_guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- SQL Editor and trusted service-role operations have no end-user auth.uid().
  if new.role is distinct from old.role
     and (select auth.uid()) is not null
     and not public.vozia_is_admin() then
    raise exception 'Only a Vozia administrator can change account roles';
  end if;
  return new;
end;
$$;

drop trigger if exists vozia_guard_profile_role on public.profiles;
create trigger vozia_guard_profile_role
  before update of role on public.profiles
  for each row execute procedure public.vozia_guard_profile_role();

drop policy if exists "Profiles are readable by administrators" on public.profiles;
create policy "Profiles are readable by administrators" on public.profiles
  for select to authenticated using ((select public.vozia_is_admin()));

drop policy if exists "Profiles are editable by administrators" on public.profiles;
create policy "Profiles are editable by administrators" on public.profiles
  for update to authenticated
  using ((select public.vozia_is_admin()))
  with check ((select public.vozia_is_admin()));

drop policy if exists "Transcriptions are readable by administrators" on public.transcriptions;
create policy "Transcriptions are readable by administrators" on public.transcriptions
  for select to authenticated using ((select public.vozia_is_admin()));

drop policy if exists "Transcriptions are editable by administrators" on public.transcriptions;
create policy "Transcriptions are editable by administrators" on public.transcriptions
  for update to authenticated
  using ((select public.vozia_is_admin()))
  with check ((select public.vozia_is_admin()));

drop policy if exists "Transcriptions are deletable by administrators" on public.transcriptions;
create policy "Transcriptions are deletable by administrators" on public.transcriptions
  for delete to authenticated using ((select public.vozia_is_admin()));
