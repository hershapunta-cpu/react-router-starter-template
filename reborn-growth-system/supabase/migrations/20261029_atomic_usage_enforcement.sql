begin;

create or replace function public.record_organization_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_usage_key text,
  p_quantity integer,
  p_request_id text,
  p_monthly_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_month_start timestamptz;
  v_used bigint;
  v_new_used bigint;
begin
  if p_organization_id is null
     or p_usage_key is null
     or p_user_id is null
     or p_usage_key not in (
       'research_runs_monthly',
       'ai_generations_monthly',
       'grant_searches_monthly'
     )
     or p_quantity is null
     or p_quantity <= 0
     or p_quantity > 1000
     or p_monthly_limit is null
     or p_monthly_limit < 0
     or p_request_id is null
     or length(trim(p_request_id)) = 0
     or length(p_request_id) > 200
  then
    raise exception 'Invalid usage request'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_usage_key,
      0
    )
  );

  v_month_start := pg_catalog.date_trunc(
    'month',
    pg_catalog.now() at time zone 'UTC'
  ) at time zone 'UTC';

  if exists (
    select 1
    from public.organization_usage_events e
    where e.organization_id = p_organization_id
      and e.usage_key = p_usage_key
      and e.request_id = p_request_id
  ) then
    select coalesce(sum(e.quantity), 0)
      into v_used
    from public.organization_usage_events e
    where e.organization_id = p_organization_id
      and e.usage_key = p_usage_key
      and e.created_at >= v_month_start;

    return pg_catalog.jsonb_build_object(
      'allowed', true,
      'duplicate', true,
      'used', v_used,
      'monthly_limit', p_monthly_limit
    );
  end if;

  select coalesce(sum(e.quantity), 0)
    into v_used
  from public.organization_usage_events e
  where e.organization_id = p_organization_id
    and e.usage_key = p_usage_key
    and e.created_at >= v_month_start;

  if v_used + p_quantity > p_monthly_limit then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'duplicate', false,
      'reason', 'usage_limit_reached',
      'used', v_used,
      'requested', p_quantity,
      'monthly_limit', p_monthly_limit
    );
  end if;

  insert into public.organization_usage_events (
    organization_id,
    user_id,
    usage_key,
    quantity,
    request_id
  )
  values (
    p_organization_id,
    p_user_id,
    p_usage_key,
    p_quantity,
    p_request_id
  );

  v_new_used := v_used + p_quantity;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'used', v_new_used,
    'monthly_limit', p_monthly_limit
  );
end;
$function$;

revoke all on function public.record_organization_usage(
  uuid, uuid, text, integer, text, integer
) from public, anon, authenticated;

grant execute on function public.record_organization_usage(
  uuid, uuid, text, integer, text, integer
) to service_role;

commit;
