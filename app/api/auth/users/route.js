import { supabaseAdmin } from "@/lib/supabase-admin";
import { attachRateLimitHeaders, enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/auth/users?org_id=xxx — list users for an organization
//
// Publiek, want het startscherm heeft de lijst nodig vóórdat er een sessie is.
// Daarmee is het ook de eerste stap van een aanval: eerst alle user-id's
// oogsten, dan pincodes raden. Een bezoeker haalt deze lijst een paar keer op;
// wie hem tientallen keren per minuut opvraagt is aan het enumereren.
export async function GET(request) {
  const gate = await enforceRateLimit({
    request,
    policy: "auth-directory",
    identifier: getClientIp(request),
    scope: "/api/auth/users",
  });
  if (gate.response) return gate.response;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id");

  if (!orgId) {
    return attachRateLimitHeaders(
      Response.json({ error: "org_id is required" }, { status: 400 }),
      gate.headers
    );
  }

  // Ongeldige id's kosten anders een database-query per gok.
  if (!UUID_RE.test(orgId)) {
    return attachRateLimitHeaders(Response.json({ users: [] }), gate.headers);
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, name, role")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    return attachRateLimitHeaders(
      Response.json({ error: error.message }, { status: 500 }),
      gate.headers
    );
  }

  return attachRateLimitHeaders(Response.json({ users: data }), gate.headers);
}
