import { CORS_HEADERS, revokeByToken } from "@/lib/oauth";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/oauth/revoke — RFC 7009. Trekt de hele koppeling in, zodat
// "ontkoppelen" in Claude ook hier zichtbaar wordt. Altijd 200, ook voor
// onbekende tokens.
export async function POST(request) {
  const gate = await enforceRateLimit({
    request,
    policy: "oauth-token-ip",
    identifier: getClientIp(request),
    scope: "/api/oauth/revoke",
  });
  if (gate.response) return gate.response;

  let token = null;
  try {
    const type = request.headers.get("content-type") || "";
    token = type.includes("application/json")
      ? (await request.json())?.token
      : (await request.formData()).get("token");
  } catch {
    // RFC 7009: geen informatie teruggeven
  }
  await revokeByToken(token);
  return new Response(null, { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
