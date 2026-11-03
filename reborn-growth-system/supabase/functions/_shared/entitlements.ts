import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export { json };

export async function resolveEntitlement(req: Request) {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "Authentication required", status: 401 };
  }

  const token = authHeader.slice(7);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } =
    await userClient.auth.getUser(token);

  if (authError || !authData.user) {
    return { error: "Invalid or expired session", status: 401 };
  }

  const user = authData.user;

  let body: { organization_id?: string };

  try {
    body = await req.json();
  } catch {
    return { error: "A JSON request body is required", status: 400 };
  }

  const organizationId = body.organization_id;

  if (
    typeof organizationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(organizationId)
  ) {
    return { error: "A valid organization_id is required", status: 400 };
  }

  // Verify membership using the authenticated user's own permissions.
  const { data: membership, error: membershipError } = await userClient
    .from("organization_members")
    .select("organization_id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    return { error: "You do not have access to this organization", status: 403 };
  }

  const { data: subscription, error: subscriptionError } = await admin
    .from("organization_subscriptions")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (subscriptionError) {
    return { error: "Could not load subscription", status: 500 };
  }

  if (!subscription) {
    return { error: "Organization subscription is not configured", status: 409 };
  }

  if (!["active", "trialing"].includes(subscription.status)) {
    return {
      error: "Organization subscription is not active",
      status: 403,
      subscription_status: subscription.status,
    };
  }

  const now = new Date();

  const trialStart = subscription.trial_started_at
    ? Date.parse(subscription.trial_started_at)
    : NaN;

  const trialEnd = subscription.trial_expires_at
    ? Date.parse(subscription.trial_expires_at)
    : NaN;

  const trialActive =
    Number.isFinite(trialStart) &&
    Number.isFinite(trialEnd) &&
    trialEnd > trialStart &&
    now.getTime() >= trialStart &&
    now.getTime() < trialEnd;

  const tierKey = trialActive
    ? subscription.trial_tier_key || "professional"
    : subscription.tier_key;

  const { data: tier, error: tierError } = await admin
    .from("package_catalog")
    .select("tier_key, display_name, limits, features, active")
    .eq("tier_key", tierKey)
    .maybeSingle();

  if (tierError || !tier || !tier.active) {
    return { error: "Package configuration is unavailable", status: 500 };
  }

  const { data: overrideRows, error: overrideError } = await admin
    .from("organization_feature_overrides")
    .select("feature_key, enabled, usage_limit, expires_at")
    .eq("organization_id", organizationId);

  if (overrideError) {
    return { error: "Could not load organization overrides", status: 500 };
  }

  const features = { ...(tier.features || {}) };
  const limits = { ...(tier.limits || {}) };

  for (const item of overrideRows || []) {
    if (item.expires_at && Date.parse(item.expires_at) <= now.getTime()) {
      continue;
    }

    if (item.enabled !== null) {
      features[item.feature_key] = item.enabled;
    }

    if (item.usage_limit !== null) {
      limits[item.feature_key] = item.usage_limit;
    }
  }

  const monthStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
  )).toISOString();

  const usageKeys = [
    "research_runs_monthly",
    "ai_generations_monthly",
    "grant_searches_monthly",
  ];

  const usage: Record<string, number> = {};

  for (const key of usageKeys) {
    const { data, error } = await admin
      .from("organization_usage_events")
      .select("quantity")
      .eq("organization_id", organizationId)
      .eq("usage_key", key)
      .gte("created_at", monthStart);

    if (error) {
      return { error: "Could not load usage records", status: 500 };
    }

    usage[key] = (data || []).reduce(
      (total, event) => total + Number(event.quantity || 0),
      0,
    );
  }

  return {
    user: { id: user.id, email: user.email },
    organization: {
      id: organizationId,
      role: membership.role,
    },
    subscription: {
      tier_key: subscription.tier_key,
      effective_tier_key: tierKey,
      status: subscription.status,
      trial_active: trialActive,
      trial_expires_at: subscription.trial_expires_at,
    },
    package: {
      name: tier.display_name,
      features,
      limits,
    },
    usage,
    usage_period_start: monthStart,
  };
}
