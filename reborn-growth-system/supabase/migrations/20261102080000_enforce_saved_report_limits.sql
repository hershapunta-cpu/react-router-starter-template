BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_saved_report_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_tier_key text := 'free_explorer';
    v_subscription_status text;
    v_trial_tier_key text;
    v_trial_started_at timestamptz;
    v_trial_expires_at timestamptz;
    v_limit integer;
    v_override_enabled boolean;
    v_override_limit integer;
    v_active_count bigint;
BEGIN
    -- Only enforce the limit for active reports.
    IF NEW.status::text NOT IN (
        'draft',
        'in_progress',
        'pending_approval',
        'approved',
        'changes_requested'
    ) THEN
        RETURN NEW;
    END IF;

    -- An already-active report in the same organization
    -- does not consume an additional report slot.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
           AND OLD.status::text IN (
               'draft',
               'in_progress',
               'pending_approval',
               'approved',
               'changes_requested'
           )
        THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Serialize report creation/restoration per organization.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            NEW.organization_id::text || ':saved_reports',
            0
        )
    );

    -- Resolve the organization's subscription and trial tier.
    SELECT
        s.status,
        s.tier_key,
        s.trial_tier_key,
        s.trial_started_at,
        s.trial_expires_at
    INTO
        v_subscription_status,
        v_tier_key,
        v_trial_tier_key,
        v_trial_started_at,
        v_trial_expires_at
    FROM public.organization_subscriptions AS s
    WHERE s.organization_id = NEW.organization_id;

    IF NOT FOUND THEN
        v_tier_key := 'free_explorer';
    ELSE
        IF v_subscription_status NOT IN ('active', 'trialing') THEN
            RAISE EXCEPTION
                'This organization does not have an active subscription.'
                USING ERRCODE = 'check_violation';
        END IF;

        -- Use the trial tier only while the trial is active.
        IF v_trial_started_at IS NOT NULL
           AND v_trial_expires_at IS NOT NULL
           AND v_trial_started_at <= pg_catalog.now()
           AND v_trial_expires_at > pg_catalog.now()
        THEN
            v_tier_key := COALESCE(
                v_trial_tier_key,
                'professional'
            );
        END IF;
    END IF;

    -- Read the saved-report allowance from the active package.
    SELECT (p.limits ->> 'saved_reports')::integer
    INTO v_limit
    FROM public.package_catalog AS p
    WHERE p.tier_key = v_tier_key
      AND p.active = true;

    IF v_limit IS NULL OR v_limit < 0 THEN
        RAISE EXCEPTION
            'A valid saved-report limit is not configured for this package.'
            USING ERRCODE = 'check_violation';
    END IF;

    -- Apply an unexpired organization-specific override.
    SELECT o.enabled, o.usage_limit
    INTO v_override_enabled, v_override_limit
    FROM public.organization_feature_overrides AS o
    WHERE o.organization_id = NEW.organization_id
      AND o.feature_key = 'saved_reports'
      AND (
          o.expires_at IS NULL
          OR o.expires_at > pg_catalog.now()
      );

    IF FOUND THEN
        IF v_override_enabled IS FALSE THEN
            v_limit := 0;
        ELSIF v_override_limit IS NOT NULL THEN
            v_limit := v_override_limit;
        END IF;
    END IF;

    -- Count active reports; archived and rejected reports are excluded.
    SELECT pg_catalog.count(*)
    INTO v_active_count
    FROM public.research_reports AS r
    WHERE r.organization_id = NEW.organization_id
      AND r.status::text IN (
          'draft',
          'in_progress',
          'pending_approval',
          'approved',
          'changes_requested'
      );

    IF v_active_count >= v_limit THEN
        RAISE EXCEPTION
            'Saved-report limit reached. Package allowance: %, active reports: %.',
            v_limit,
            v_active_count
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_saved_report_limit()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS research_reports_enforce_saved_report_limit
ON public.research_reports;

CREATE TRIGGER research_reports_enforce_saved_report_limit
BEFORE INSERT OR UPDATE OF organization_id, status
ON public.research_reports
FOR EACH ROW
EXECUTE FUNCTION public.enforce_saved_report_limit();

COMMENT ON FUNCTION public.enforce_saved_report_limit()
IS 'Enforces organization saved-report package limits without deleting existing reports.';

COMMIT;
