-- Single-send, staff-approved customer welcome packet delivery receipts.
-- Retell/Amanda dialing and customer jobs are unaffected.
create table if not exists public.sales_welcome_packets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.sales_leads(id) on delete cascade,
  recipient_email text not null,
  business_name text not null,
  contact_name text,
  approval_source text not null check (approval_source in ('phone','email','in_person','website','other')),
  consent_attested_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  status text not null default 'sending' check (status in ('sending','sent','needs_review')),
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_welcome_packets_status_idx on public.sales_welcome_packets(status, created_at desc);

alter table public.sales_welcome_packets enable row level security;
revoke all privileges on table public.sales_welcome_packets from anon;
revoke all privileges on table public.sales_welcome_packets from authenticated;
grant select on public.sales_welcome_packets to authenticated;
grant select, insert, update, delete on public.sales_welcome_packets to service_role;

create policy "Dispatch can see welcome packet status" on public.sales_welcome_packets
for select to authenticated using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
    and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_'))
       in ('admin','staff','dispatcher')
  )
);
comment on table public.sales_welcome_packets is
'Immutable first-send reservation per lead, with dispatch attestation and email delivery receipt. No client writes or auto-retries.';
