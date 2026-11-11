-- Only server functions may access push endpoints, encryption keys and deliveries.
create table if not exists public.dispatch_push_config (
  id text primary key check (id = 'default'),
  public_key text not null,
  private_key text not null
);
create table if not exists public.dispatch_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text unique not null,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists dispatch_push_user_idx on public.dispatch_push_subscriptions(user_id);
create table if not exists public.dispatch_push_events (
  event_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists dispatch_push_event_time_idx on public.dispatch_push_events(created_at);
create table if not exists public.dispatch_push_deliveries (
  event_key text not null references public.dispatch_push_events(event_key) on delete cascade,
  subscription_id uuid not null references public.dispatch_push_subscriptions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(event_key, subscription_id)
);
alter table public.dispatch_push_config enable row level security;
alter table public.dispatch_push_subscriptions enable row level security;
alter table public.dispatch_push_events enable row level security;
alter table public.dispatch_push_deliveries enable row level security;
revoke all on public.dispatch_push_config, public.dispatch_push_subscriptions, public.dispatch_push_events, public.dispatch_push_deliveries from public, anon, authenticated;
grant all on public.dispatch_push_config, public.dispatch_push_subscriptions, public.dispatch_push_events, public.dispatch_push_deliveries to service_role;
