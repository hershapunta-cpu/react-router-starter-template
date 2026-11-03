import {
  resolveEntitlement,
  admin,
  json,
} from "../_shared/entitlements.ts";

const VALID_KEYS = [
  "research_runs_monthly",
  "ai_generations_monthly",
  "grant_searches_monthly",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    let body: {
      organization_id?: string;
      usage_key?: string;
      quantity?: number;
      request_id?: string;
    };

    try {
      body = await req.clone().json();
    } catch {
      return json({ error: "A JSON request body is required" }, 400);
    }

    if (
      typeof body.usage_key !== "string" ||
      !VALID_KEYS.includes(body.usage_key) ||
      !Number.isInteger(body.quantity) ||
      !body.quantity ||
      body.quantity < 1 ||
      body.quantity > 1000 ||
      typeof body.request_id !== "string" ||
      !body.request_id.trim() ||
      body.request_id.length > 200
    ) {
      return json({ error: "Invalid usage request" }, 400);
    }

    const entitlement = await resolveEntitlement(req);

    if ("error" in entitlement) {
      return json(
        entitlement,
        Number(entitlement.status || 500),
      );
    }

    const usageKey = body.usage_key;
    const limit = entitlement.package.limits[usageKey];

    if (
      typeof limit !== "number" ||
      !Number.isFinite(limit) ||
      limit < 0
    ) {
      return json({ error: "Usage limit is not configured" }, 500);
    }

    const { data, error } = await admin.rpc(
      "record_organization_usage",
      {
        p_organization_id: entitlement.organization.id,
        p_user_id: entitlement.user.id,
        p_usage_key: usageKey,
        p_quantity: body.quantity,
        p_request_id: body.request_id,
        p_monthly_limit: limit,
      },
    );

    if (error) {
      console.error("Usage recording failed:", error);
      return json({ error: "Could not record usage" }, 500);
    }

    if (data?.duplicate === true) {
      return json({
        ok: true,
        duplicate: true,
        execute_action: false,
        usage: data,
      });
    }

    if (data?.allowed !== true) {
      return json({
        ok: false,
        error: "Monthly usage limit reached",
        usage: data,
      }, 429);
    }

    return json({
      ok: true,
      duplicate: false,
      execute_action: true,
      usage: data,
    });
  } catch (error) {
    console.error("record-usage error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
