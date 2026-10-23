-- ReBoRn Studio schema
-- Additive and safe to re-run: every object is prefixed studio_ so it never
-- touches your existing tables. Run in the Supabase SQL editor on the
-- EXISTING project (do not create a new database).

create extension if not exists pgcrypto;

-- ───────────── Workspaces & members ─────────────
create table if not exists studio_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('own','client')),  -- 'own' = ReBoRn itself (workspace #0)
  plan text not null default 'free' check (plan in ('free','client','agency')),
  paypal_subscription_id text,
  voice_consent boolean not null default false,          -- written consent before any voice cloning
  created_at timestamptz not null default now()
);
-- only one ReBoRn "own" workspace
create unique index if not exists studio_one_own
  on studio_workspaces (kind) where kind = 'own';

create table if not exists studio_members (
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','client')),
  primary key (workspace_id, user_id)
);
-- You (agency owner) are added as 'owner' in EVERY workspace, own and client.

create or replace function studio_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from studio_members
  where workspace_id = ws and user_id = auth.uid()
$$;

-- ───────────── Content & approvals ─────────────
-- draft -> pending_owner -> (own: ready | client: pending_client -> ready) -> published
create table if not exists studio_content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  type text not null check (type in ('script','voice','video','dub','post','ad')),
  title text,
  body text,
  asset_url text,
  lang text not null default 'en',
  status text not null default 'draft'
    check (status in ('draft','pending_owner','pending_client','ready','published','rejected')),
  scheduled_for timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists studio_approvals (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references studio_content_items(id) on delete cascade,
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  decided_by uuid references auth.users(id),
  role text,
  decision text not null check (decision in ('approve','reject')),
  note text,
  created_at timestamptz not null default now()
);

-- ───────────── Sales pipeline ─────────────
create table if not exists studio_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  name text,
  contact text,
  source text,
  status text not null default 'new'
    check (status in ('new','qualified','call_booked','won','lost')),
  nikki_summary text,
  created_at timestamptz not null default now()
);

create table if not exists studio_sales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  lead_id uuid references studio_leads(id) on delete set null,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  paypal_txn_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists studio_costs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references studio_workspaces(id) on delete cascade,
  vendor text not null,              -- elevenlabs, higgsfield, metricool, ...
  amount_usd numeric(10,2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- ───────────── Plans & entitlements ─────────────
create table if not exists studio_plan_tools (
  plan text not null check (plan in ('free','client','agency')),
  tool text not null,
  primary key (plan, tool)
);

-- Edit these tool names to match your real ReBoRn Tools app.
insert into studio_plan_tools (plan, tool) values
  ('free','hex_toolkit'),('free','margin_calculator'),
  ('client','hex_toolkit'),('client','margin_calculator'),
  ('client','studio_scripts'),('client','studio_voice'),('client','studio_posting'),
  ('agency','hex_toolkit'),('agency','margin_calculator'),
  ('agency','studio_scripts'),('agency','studio_voice'),('agency','studio_posting'),
  ('agency','studio_dubbing'),('agency','nikki_sales_line'),
  ('agency','market_desk'),('agency','ad_intelligence')
on conflict do nothing;

create or replace function studio_has_tool(ws uuid, t text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from studio_workspaces w
    join studio_plan_tools p on p.plan = w.plan
    where w.id = ws and p.tool = t
      and studio_role(ws) is not null
  )
$$;

-- ───────────── Row-level security (client-to-client isolation) ─────────────
alter table studio_workspaces    enable row level security;
alter table studio_members       enable row level security;
alter table studio_content_items enable row level security;
alter table studio_approvals     enable row level security;
alter table studio_leads         enable row level security;
alter table studio_sales         enable row level security;
alter table studio_costs         enable row level security;
alter table studio_plan_tools    enable row level security;

drop policy if exists ws_read on studio_workspaces;
create policy ws_read on studio_workspaces for select
  using (studio_role(id) is not null);
-- no insert/update policy: only your service key (server side) changes plans

drop policy if exists mem_read on studio_members;
create policy mem_read on studio_members for select
  using (user_id = auth.uid() or studio_role(workspace_id) = 'owner');

drop policy if exists tools_read on studio_plan_tools;
create policy tools_read on studio_plan_tools for select using (true);

-- content: members read; owner/editor write; nobody but the server sets 'published'
drop policy if exists content_read on studio_content_items;
create policy content_read on studio_content_items for select
  using (studio_role(workspace_id) is not null);

drop policy if exists content_write on studio_content_items;
create policy content_write on studio_content_items for insert
  with check (studio_role(workspace_id) in ('owner','editor')
              and status in ('draft','pending_owner'));

drop policy if exists content_update on studio_content_items;
create policy content_update on studio_content_items for update
  using (studio_role(workspace_id) in ('owner','editor'))
  with check (status in ('draft','pending_owner'));
-- approvals/status moves past pending_owner happen ONLY via studio_decide()

drop policy if exists appr_read on studio_approvals;
create policy appr_read on studio_approvals for select
  using (studio_role(workspace_id) is not null);

-- leads/sales/costs: owner+editor read & write, client reads leads/sales only
drop policy if exists leads_read on studio_leads;
create policy leads_read on studio_leads for select
  using (studio_role(workspace_id) is not null);
drop policy if exists leads_write on studio_leads;
create policy leads_write on studio_leads for all
  using (studio_role(workspace_id) in ('owner','editor'))
  with check (studio_role(workspace_id) in ('owner','editor'));

drop policy if exists sales_read on studio_sales;
create policy sales_read on studio_sales for select
  using (studio_role(workspace_id) is not null);
-- sales rows are written by the PayPal webhook (service key), not by users

drop policy if exists costs_owner on studio_costs;
create policy costs_owner on studio_costs for select
  using (studio_role(workspace_id) = 'owner');

-- ───────────── The approval gate ─────────────
create or replace function studio_decide(item uuid, decision text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  ws uuid; cur text; r text; k text; nxt text;
begin
  select workspace_id, status into ws, cur from studio_content_items where id = item;
  if ws is null then raise exception 'item not found'; end if;

  r := studio_role(ws);
  if r is null then raise exception 'not allowed'; end if;
  select kind into k from studio_workspaces where id = ws;

  if decision = 'reject' then
    if r in ('owner','client') and cur in ('pending_owner','pending_client') then
      nxt := 'rejected';
    end if;
  elsif decision = 'approve' then
    if r = 'owner' and cur = 'pending_owner' then
      nxt := case when k = 'own' then 'ready' else 'pending_client' end;
    elsif r = 'client' and cur = 'pending_client' then
      nxt := 'ready';
    end if;
  end if;

  if nxt is null then raise exception 'decision not allowed at this stage'; end if;

  update studio_content_items set status = nxt where id = item;
  insert into studio_approvals (item_id, workspace_id, decided_by, role, decision, note)
  values (item, ws, auth.uid(), r, decision, note);
end $$;

-- ───────────── Morning brief source ─────────────
create or replace view studio_brief_v with (security_invoker = true) as
select
  w.id as workspace_id,
  w.name,
  (select count(*) from studio_leads l
     where l.workspace_id = w.id and l.created_at > now() - interval '1 day') as new_leads,
  (select count(*) from studio_leads l
     where l.workspace_id = w.id and l.status = 'call_booked') as calls_booked,
  (select count(*) from studio_sales s
     where s.workspace_id = w.id and s.created_at > now() - interval '1 day') as sales_24h,
  (select coalesce(sum(amount),0) from studio_sales s
     where s.workspace_id = w.id and s.created_at > now() - interval '1 day') as revenue_24h,
  (select coalesce(sum(amount_usd),0) from studio_costs c
     where c.workspace_id = w.id and c.created_at > now() - interval '30 days') as cost_30d,
  (select count(*) from studio_content_items i
     where i.workspace_id = w.id and i.status in ('pending_owner','pending_client')) as awaiting_approval
from studio_workspaces w;

-- ───────────── Seed ReBoRn as workspace #0 ─────────────
insert into studio_workspaces (name, kind, plan)
select 'ReBoRn Marketing Solution Agency', 'own', 'agency'
where not exists (select 1 from studio_workspaces where kind = 'own');
