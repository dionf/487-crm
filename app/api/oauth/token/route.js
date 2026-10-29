import {
  CORS_HEADERS,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  oauthError,
  oauthJson,
} from "@/lib/oauth";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function readParams(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  }
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

// POST /api/oauth/token — authorization_code (met PKCE) en refresh_token.
export async function POST(request) {
  const gate = await enforceRateLimit({
    request,
    policy: "oauth-token-ip",
    identifier: getClientIp(request),
    scope: "/api/oauth/token",
  });
  if (gate.response) return gate.response;

  let params;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "Ongeldige body");
  }

  let result;
  if (params.grant_type === "authorization_code") {
    if (!params.code || !params.redirect_uri || !params.code_verifier) {
      return oauthError("invalid_request", "code, redirect_uri en code_verifier zijn verplicht");
    }
    result = await exchangeAuthorizationCode({
      code: params.code,
      redirectUri: params.redirect_uri,
      clientId: params.client_id,
      codeVerifier: params.code_verifier,
    });
  } else if (params.grant_type === "refresh_token") {
    if (!params.refresh_token) return oauthError("invalid_request", "refresh_token is verplicht");
    result = await exchangeRefreshToken({ refreshToken: params.refresh_token, clientId: params.client_id });
  } else {
    return oauthError("unsupported_grant_type", "Alleen authorization_code en refresh_token");
  }

  if (result.error) return oauthError(result.error, result.description);
  return oauthJson(result.tokens);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
