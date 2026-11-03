-- Package entitlements foundation.
-- Additive only: existing tables and user data remain unchanged.
-- Review and test before applying to any live database.

begin;

create table if not exists public.package_catalog (
  tier_key text primary key,
  display_name text not null,
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint package_catalog_tier_key_valid
    check (tier_key in (
      'free_explorer',
      'starter',
      'professional',
      'agency_enterprise'
    )),
  constraint package_catalog_limits_object
    check (jsonb_typeof(limits) = 'object'),
  constraint package_catalog_features_object
    check (jsonb_typeof(features) = 'object')
);


-- Seed default packages without overwriting administrator changes.
insert into public.package_catalog (tier_key, display_name, limits, features)
values
(
  'free_explorer', 'Free Explorer',
  '{"research_runs_monthly":5,"ai_generations_monthly":10,"grant_searches_monthly":10,"saved_reports":5}'::jsonb,
  '{"basic_research":true,"basic_grant_finder":true,"competitor_profiles":true,"offer_management":true,"acquisition_planning":true,"retention_planning":true,"performance_scorecard":true,"deep_research":false,"grant_eligibility_analysis":false,"advanced_matching":false,"application_support":false}'::jsonb
),
(
  'starter', 'Starter',
  '{"research_runs_monthly":30,"ai_generations_monthly":100,"grant_searches_monthly":50,"saved_reports":25}'::jsonb,
  '{"basic_research":true,"basic_grant_finder":true,"competitor_profiles":true,"offer_management":true,"acquisition_planning":true,"retention_planning":true,"performance_scorecard":true,"deep_research":false,"grant_eligibility_analysis":true,"advanced_matching":false,"application_support":false}'::jsonb
),
(
  'professional', 'Professional',
  '{"research_runs_monthly":150,"ai_generations_monthly":500,"grant_searches_monthly":250,"saved_reports":150}'::jsonb,
  '{"basic_research":true,"basic_grant_finder":true,"competitor_profiles":true,"offer_management":true,"acquisition_planning":true,"retention_planning":true,"performance_scorecard":true,"deep_research":true,"grant_eligibility_analysis":true,"advanced_matching":true,"application_support":true}'::jsonb
),
(
  'agency_enterprise', 'Agency / Enterprise',
  '{"research_runs_monthly":1000,"ai_generations_monthly":3000,"grant_searches_monthly":1500,"saved_reports":1000}'::jsonb,
  '{"basic_research":true,"basic_grant_finder":true,"competitor_profiles":true,"offer_management":true,"acquisition_planning":true,"retention_planning":true,"performance_scorecard":true,"deep_research":true,"grant_eligibility_analysis":true,"advanced_matching":true,"application_support":true}'::jsonb
)
on conflict (tier_key) do nothing;

create table if not exists public.organization_subscriptions (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  tier_key text not null default 'free_explorer'
    references public.package_catalog(tier_key),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'suspended', 'cancelled')),
  trial_tier_key text
    references public.package_catalog(tier_key),
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint organization_trial_dates_valid
    check (
      trial_expires_at is null
      or trial_started_at is null
      or trial_expires_at > trial_started_at
    )
);


-- Give existing organizations the free tier only when no subscription exists.
insert into public.organization_subscriptions (organization_id, tier_key, status)
select o.id, 'free_explorer', 'active'
from public.organizations as o
on conflict (organization_id) do nothing;

create table if not exists public.organization_feature_overrides (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  feature_key text not null,
  enabled boolean,
  usage_limit integer,
  expires_at timestamptz,
  reason text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (organization_id, feature_key),
  constraint organization_feature_override_limit_valid
    check (usage_limit is null or usage_limit >= 0)
);

create table if not exists public.organization_usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  usage_key text not null
    check (usage_key in (
      'research_runs_monthly',
      'ai_generations_monthly',
      'grant_searches_monthly'
    )),
  quantity integer not null default 1
    check (quantity > 0),
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint organization_usage_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists organization_usage_org_key_date_idx
  on public.organization_usage_events
  (organization_id, usage_key, created_at);

create unique index if not exists organization_usage_request_dedup_idx
  on public.organization_usage_events
  (organization_id, request_id, usage_key)
  where request_id is not null;

alter table public.package_catalog enable row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_feature_overrides enable row level security;
alter table public.organization_usage_events enable row level security;

-- Authenticated users can read active package descriptions only.
drop policy if exists package_catalog_read_active
  on public.package_catalog;

create policy package_catalog_read_active
  on public.package_catalog
  for select to authenticated
  using (active = true);

-- Organization members can view their organization's subscription.
drop policy if exists organization_subscription_read_member
  on public.organization_subscriptions;

create policy organization_subscription_read_member
  on public.organization_subscriptions
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Only organization owners/admins can read feature overrides.
drop policy if exists organization_feature_overrides_read_admin
  on public.organization_feature_overrides;

create policy organization_feature_overrides_read_admin
  on public.organization_feature_overrides
  for select to authenticated
  using (
    public.has_org_role(
      organization_id,
      array['owner'::public.member_role, 'admin'::public.member_role]
    )
  );

-- Only organization owners/admins can read usage records.
drop policy if exists organization_usage_events_read_admin
  on public.organization_usage_events;

create policy organization_usage_events_read_admin
  on public.organization_usage_events
  for select to authenticated
  using (
    public.has_org_role(
      organization_id,
      array['owner'::public.member_role, 'admin'::public.member_role]
    )
  );

-- Deliberately no client INSERT/UPDATE/DELETE policies on billing,
-- overrides, or usage events. Trusted server-side code must write them.

commit;
