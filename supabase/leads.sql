-- MG Express sales leads CRM
create extension if not exists pgcrypto;

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  business text not null,
  contact text,
  industry text,
  status text not null default 'New Lead' check (status in ('New Lead','Contacted','Follow-Up','Quote Requested','Customer','Not Interested')),
  phone text,
  email text,
  address text,
  last_contact date,
  next_follow_up date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_leads_status_idx on public.sales_leads(status);
create index if not exists sales_leads_follow_up_idx on public.sales_leads(next_follow_up);
create index if not exists sales_leads_industry_idx on public.sales_leads(industry);

create or replace function public.set_sales_leads_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sales_leads_updated_at on public.sales_leads;
create trigger sales_leads_updated_at
before update on public.sales_leads
for each row execute function public.set_sales_leads_updated_at();

alter table public.sales_leads enable row level security;

drop policy if exists "Dispatch staff can view sales leads" on public.sales_leads;
create policy "Dispatch staff can view sales leads"
on public.sales_leads for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_')) in ('admin','staff','dispatcher')
  )
);

drop policy if exists "Dispatch staff can create sales leads" on public.sales_leads;
create policy "Dispatch staff can create sales leads"
on public.sales_leads for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_')) in ('admin','staff','dispatcher')
  )
);

drop policy if exists "Dispatch staff can update sales leads" on public.sales_leads;
create policy "Dispatch staff can update sales leads"
on public.sales_leads for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_')) in ('admin','staff','dispatcher')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_')) in ('admin','staff','dispatcher')
  )
);

drop policy if exists "Dispatch staff can delete sales leads" on public.sales_leads;
create policy "Dispatch staff can delete sales leads"
on public.sales_leads for delete
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),' ','_'),'-','_')) in ('admin','staff','dispatcher')
  )
);

grant select, insert, update, delete on public.sales_leads to authenticated;