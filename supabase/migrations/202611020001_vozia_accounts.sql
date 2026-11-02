create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  project text not null default 'Nova transcrição',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  media_type text not null default 'application/octet-stream',
  language text not null default 'auto',
  detected_language text,
  status text not null default 'uploading' check (status in ('uploading','queued','loading_model','transcribing','completed','failed')),
  transcript text not null default '',
  segments jsonb not null default '[]'::jsonb,
  error text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcriptions_user_created_idx on public.transcriptions (user_id, created_at desc);
create index if not exists transcriptions_user_status_idx on public.transcriptions (user_id, status);

alter table public.profiles enable row level security;
alter table public.transcriptions enable row level security;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
create policy "Profiles are readable by their owner" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "Profiles are editable by their owner" on public.profiles;
create policy "Profiles are editable by their owner" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Transcriptions are readable by their owner" on public.transcriptions;
create policy "Transcriptions are readable by their owner" on public.transcriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Transcriptions can be created by their owner" on public.transcriptions;
create policy "Transcriptions can be created by their owner" on public.transcriptions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Transcriptions can be updated by their owner" on public.transcriptions;
create policy "Transcriptions can be updated by their owner" on public.transcriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Transcriptions can be deleted by their owner" on public.transcriptions;
create policy "Transcriptions can be deleted by their owner" on public.transcriptions
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.vozia_create_profile()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists vozia_auth_user_created on auth.users;
create trigger vozia_auth_user_created
  after insert on auth.users
  for each row execute procedure public.vozia_create_profile();

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.transcriptions to authenticated;
