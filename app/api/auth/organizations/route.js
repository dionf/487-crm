import { supabaseAdmin } from "@/lib/supabase-admin";
import { attachRateLimitHeaders, enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// GET /api/auth/organizations — list all orgs for the start screen
//
// Zelfde reden voor een limiet als bij /api/auth/users: dit is publiek en het
// is de ingang van de loginflow, dus het punt waar een scanner begint.
export async function GET(request) {
  const gate = await enforceRateLimit({
    request,
    policy: "auth-directory",
    identifier: getClientIp(request),
    scope: "/api/auth/organizations",
  });
  if (gate.response) return gate.response;

  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id, slug, display_name, theme")
    .order("created_at");

  if (error) {
    return attachRateLimitHeaders(
      Response.json({ error: error.message }, { status: 500 }),
      gate.headers
    );
  }

  return attachRateLimitHeaders(Response.json({ organizations: data }), gate.headers);
}
