import { resolveEntitlement, json } from "../_shared/entitlements.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const result = await resolveEntitlement(req);

    if ("error" in result) {
      const status = Number(result.status || 500);
      return json(result, status);
    }

    return json({ ok: true, ...result });
  } catch (error) {
    console.error("check-entitlement error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
