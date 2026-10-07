-- MG Express Team Management support
-- Applied to production Supabase on 2026-10-07.

alter table public.profiles
  add column if not exists team_member boolean not null default false,
  add column if not exists team_role text,
  add column if not exists team_disabled_at timestamptz;

update public.profiles
set team_member = true,
    team_role = lower(role)
where lower(coalesce(role, '')) in ('admin', 'staff', 'dispatcher');
