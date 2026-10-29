import {
  CORS_HEADERS,
  isAllowedRedirectUri,
  oauthError,
  oauthJson,
  registerClient,
} from "@/lib/oauth";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/oauth/register — dynamic client registration (RFC 7591).
// Alleen public clients met PKCE: er wordt geen client_secret uitgegeven, de
// registratie zelf geeft dus geen toegang tot data.
export async function POST(request) {
  const gate = await enforceRateLimit({
    request,
    policy: "oauth-register",
    identifier: getClientIp(request),
    scope: "/api/oauth/register",
  });
  if (gate.response) return gate.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body moet JSON zijn");
  }

  const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (!redirectUris.length || redirectUris.length > 10) {
    return oauthError("invalid_redirect_uri", "Geef 1 tot 10 redirect_uris op");
  }
  if (!redirectUris.every((u) => typeof u === "string" && u.length <= 500 && isAllowedRedirectUri(u))) {
    return oauthError("invalid_redirect_uri", "Alleen https of http://localhost redirect-URI's");
  }

  const authMethod = body.token_endpoint_auth_method || "none";
  if (authMethod !== "none") {
    return oauthError("invalid_client_metadata", "Alleen public clients (token_endpoint_auth_method: none)");
  }

  const clientName =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "Claude";

  const client = await registerClient({ client_name: clientName, redirect_uris: redirectUris });

  return oauthJson(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(new Date(client.created_at).getTime() / 1000),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "crm",
    },
    201
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
