-- Amanda: separate, fail-closed AI sales consent and suppression foundations.
-- No phone calls or Retell routing are configured by this migration.
-- Do not expose sales lead data to anonymous API clients.
revoke all privileges on table public.sales_leads from anon;

create table if not exists public.sales_ai_permissions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  permission_kind text not null default 'ai_marketing_voice' check (permission_kind = 'ai_marketing_voice'),
  review_status text not null default 'pending' check (review_status in ('pending','verified','rejected','revoked')),
  source text not null,
  exact_permission_text text not null,
  proof_reference text not null,
  consented_at timestamptz not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint consent_expiry_after_grant check (expires_at > consented_at),
  constraint sales_permission_verified_proof check (
    review_status <> 'verified' or
    (verified_at is not null and verified_by is not null and revoked_at is null)
  )
);
create index if not exists sales_ai_permissions_lead_idx on public.sales_ai_permissions(lead_id, review_status, expires_at);

create table if not exists public.sales_ai_dnc (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null default 'Do not contact',
  source text not null default 'Staff',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sales_ai_call_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.sales_leads(id) on delete set null,
  provider_call_id text unique,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  event_kind text not null,
  event_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index if not exists sales_ai_call_events_lead_idx on public.sales_ai_call_events(lead_id, event_at desc);

alter table public.sales_ai_permissions enable row level security;
alter table public.sales_ai_dnc enable row level security;
alter table public.sales_ai_call_events enable row level security;

revoke all privileges on public.sales_ai_permissions, public.sales_ai_dnc, public.sales_ai_call_events from anon;
revoke all privileges on public.sales_ai_permissions, public.sales_ai_dnc, public.sales_ai_call_events from authenticated;
grant select on public.sales_ai_permissions, public.sales_ai_dnc, public.sales_ai_call_events to authenticated;
grant insert on public.sales_ai_dnc to authenticated;
grant select, insert, update, delete on public.sales_ai_permissions, public.sales_ai_dnc, public.sales_ai_call_events to service_role;

-- Staff can view records, but cannot mark consent 'verified' themselves via the browser.
create policy "Sales staff can read AI permissions" on public.sales_ai_permissions
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role in ('admin','dispatcher','staff'))
  );
create policy "Sales staff can read DNC" on public.sales_ai_dnc
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role in ('admin','dispatcher','staff'))
  );
create policy "Sales staff can add DNC" on public.sales_ai_dnc
  for insert to authenticated with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role in ('admin','dispatcher','staff'))
  );
create policy "Sales staff can view call events" on public.sales_ai_call_events
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role in ('admin','dispatcher','staff'))
  );

comment on table public.sales_ai_permissions is 'Evidence of phone-specific AI marketing call consent; pending by default and server-only verification.';
comment on table public.sales_ai_dnc is 'Global suppression list for Amanda and all MG Express sales campaigns.';
comment on table public.sales_ai_call_events is 'Server-written audit log for Amanda sales call preflights and provider callbacks.';