-- Customer journey: manually verified lead -> real completed orders, outreach receipts.
-- A company earns invitation eligibility after TEN completed deliveries (not quotes).
-- No customer portal account, password, or biweekly billing is created here.
create table if not exists public.sales_lead_orders (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now()
);
create index if not exists sales_lead_orders_lead_idx on public.sales_lead_orders(lead_id);
create table if not exists public.sales_customer_outreach (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.sales_leads(id) on delete cascade,
  outreach_type text not null check(outreach_type in ('trial_thanks','account_offer')),
  status text not null default 'sending' check(status in ('sending','sent','needs_review')),
  recipient_email text not null,
  permission_source text not null check(permission_source in ('phone','email','in_person','website','other')),
  approved_by uuid references auth.users(id) on delete set null,
  provider_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(lead_id,outreach_type)
);
alter table public.sales_lead_orders enable row level security;
alter table public.sales_customer_outreach enable row level security;
revoke all on public.sales_lead_orders, public.sales_customer_outreach from anon, authenticated;
grant select on public.sales_lead_orders, public.sales_customer_outreach to authenticated;
grant all on public.sales_lead_orders, public.sales_customer_outreach to service_role;
create policy "Dispatch read linked sales deliveries" on public.sales_lead_orders
 for select to authenticated using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','staff','dispatcher'))
 );
create policy "Dispatch read customer outreach" on public.sales_customer_outreach
 for select to authenticated using (
  exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','staff','dispatcher'))
 );
comment on table public.sales_lead_orders is 'Explicit staff verified links to real orders; customer portal login NOT required.';
comment on table public.sales_customer_outreach is 'Staff-approved one-time thank you and 10th-delivery account application offer, not customer account creation.';
