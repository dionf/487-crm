/**
 * OAuth 2.1 voor het remote MCP-endpoint (migratie 040).
 *
 * Een kleine authorization server in de app zelf: Claude registreert zich als
 * public client (RFC 7591), de gebruiker logt in met e-mail en pincode, en
 * krijgt via authorization code + PKCE (S256) een access token (1 uur) en een
 * refresh token (30 dagen, roteert bij elk gebruik).
 *
 * Tokens zijn opaque random strings. In de database staat alleen de sha256:
 * wie oauth_tokens leest, kan er niets mee.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const ACCESS_TOKEN_TTL = 60 * 60; // 1 uur
export const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 dagen
export const CODE_TTL = 60 * 10; // 10 minuten
export const SUPPORTED_SCOPES = ["crm"];

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Publieke origin van dit verzoek. Achter Vercel komt de echte host in
 * x-forwarded-host; het domein dat de gebruiker in Claude invulde
 * (crm.48-7.nl of 487crm.vercel.app) moet ook in de metadata terugkomen.
 */
export function getOrigin(request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  if (host) return `${proto.split(",")[0]}://${host.split(",")[0]}`;
  return new URL(request.url).origin;
}

export function mcpResourceUrl(origin) {
  return `${origin}/api/mcp`;
}

export function protectedResourceMetadataUrl(origin) {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
  };
}

export function protectedResourceMetadata(origin) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "48-7 CRM",
  };
}

// Metadata en token-endpoints worden ook vanuit de browser aangeroepen
// (claude.ai-connectorflow). Ze geven niets prijs zonder token, dus open CORS.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export function oauthJson(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache", ...extraHeaders },
  });
}

export function oauthError(error, description, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

/**
 * Redirect-URI's: https, of loopback over http (Claude Code luistert lokaal op
 * een willekeurige poort). Geen fragmenten, geen andere schema's.
 */
export function isAllowedRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  return false;
}

/**
 * Exacte match, behalve de poort bij loopback-URI's: native clients kiezen
 * die pas bij het starten van de flow (RFC 8252 §7.3).
 */
export function redirectUriMatches(registered, requested) {
  if (registered.includes(requested)) return true;
  let req;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== "http:") return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return (
        reg.protocol === "http:" &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

export async function getClient(clientId) {
  if (!clientId || typeof clientId !== "string" || clientId.length > 100) return null;
  const { data } = await supabaseAdmin
    .from("oauth_clients")
    .select("id, client_name, redirect_uris")
    .eq("id", clientId)
    .maybeSingle();
  return data || null;
}

export async function registerClient({ client_name, redirect_uris }) {
  const id = `crm_${randomUUID().replace(/-/g, "")}`;
  const { data, error } = await supabaseAdmin
    .from("oauth_clients")
    .insert({ id, client_name, redirect_uris })
    .select("id, client_name, redirect_uris, created_at")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Controleert de parameters van een autorisatieverzoek. Retourneert
 * { client, params } of { error } met een Nederlandse melding. Bij een
 * ongeldige client of redirect_uri mag er niet geredirect worden (de URI is
 * dan zelf niet te vertrouwen), dus die fouten tonen we op de pagina.
 */
export async function validateAuthorizeRequest(params) {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const client = await getClient(clientId);
  if (!client) return { error: "Onbekende client. Verwijder de connector in Claude en voeg hem opnieuw toe." };
  if (!redirectUri || !redirectUriMatches(client.redirect_uris, redirectUri)) {
    return { error: "De redirect-URI hoort niet bij deze client." };
  }
  if (params.response_type !== "code") {
    return { client, redirectError: "unsupported_response_type" };
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    return { client, redirectError: "invalid_request", redirectDescription: "PKCE met S256 is verplicht" };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge)) {
    return { client, redirectError: "invalid_request", redirectDescription: "Ongeldige code_challenge" };
  }
  const requested = (params.scope || "crm").split(/\s+/).filter(Boolean);
  if (requested.some((s) => !SUPPORTED_SCOPES.includes(s))) {
    return { client, redirectError: "invalid_scope" };
  }
  return { client, scopes: SUPPORTED_SCOPES };
}

export function buildRedirect(redirectUri, query) {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  return url.toString();
}

function inSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Nieuwe koppeling plus eenmalige code. De koppeling verloopt na de
 * code-levensduur tenzij de code wordt ingewisseld; dan schuift hij naar de
 * refresh-horizon. Zo blijven afgebroken flows niet in het overzicht hangen.
 */
export async function createGrantWithCode({ userId, clientId, scopes, codeChallenge, redirectUri }) {
  const { data: grant, error } = await supabaseAdmin
    .from("oauth_grants")
    .insert({ user_id: userId, client_id: clientId, scopes, expires_at: inSeconds(CODE_TTL) })
    .select("id")
    .single();
  if (error) throw error;

  const code = randomToken();
  const { error: codeError } = await supabaseAdmin.from("oauth_tokens").insert({
    grant_id: grant.id,
    kind: "code",
    token_hash: hashToken(code),
    code_challenge: codeChallenge,
    redirect_uri: redirectUri,
    expires_at: inSeconds(CODE_TTL),
  });
  if (codeError) throw codeError;
  return code;
}

export async function revokeGrant(grantId) {
  const now = new Date().toISOString();
  await supabaseAdmin.from("oauth_grants").update({ revoked_at: now }).eq("id", grantId).is("revoked_at", null);
  await supabaseAdmin.from("oauth_tokens").update({ revoked_at: now }).eq("grant_id", grantId).is("revoked_at", null);
}

/**
 * Markeert een code of refresh token als verbruikt. Atomair: van twee
 * gelijktijdige inwisselingen krijgt er precies één de rij terug. Retourneert
 * { token, grant } of { error, replay }.
 */
async function consumeToken(rawToken, kind) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 200) return { error: "invalid_grant" };
  const hash = hashToken(rawToken);
  const { data: token } = await supabaseAdmin
    .from("oauth_tokens")
    .select("id, grant_id, kind, code_challenge, redirect_uri, expires_at, used_at, revoked_at, oauth_grants(id, user_id, client_id, scopes, revoked_at)")
    .eq("token_hash", hash)
    .eq("kind", kind)
    .maybeSingle();
  if (!token) return { error: "invalid_grant" };

  // Hergebruik van een verbruikte code of geroteerde refresh token betekent
  // dat iemand anders hem ook heeft: de hele koppeling gaat dicht.
  if (token.used_at) {
    await revokeGrant(token.grant_id);
    return { error: "invalid_grant", replay: true };
  }
  if (token.revoked_at || token.oauth_grants?.revoked_at) return { error: "invalid_grant" };
  if (new Date(token.expires_at) < new Date()) return { error: "invalid_grant" };

  const { data: claimed } = await supabaseAdmin
    .from("oauth_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", token.id)
    .is("used_at", null)
    .select("id");
  if (!claimed?.length) {
    await revokeGrant(token.grant_id);
    return { error: "invalid_grant", replay: true };
  }
  return { token, grant: token.oauth_grants };
}

async function issueTokenPair(grant) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const { error } = await supabaseAdmin.from("oauth_tokens").insert([
    { grant_id: grant.id, kind: "access", token_hash: hashToken(accessToken), expires_at: inSeconds(ACCESS_TOKEN_TTL) },
    { grant_id: grant.id, kind: "refresh", token_hash: hashToken(refreshToken), expires_at: inSeconds(REFRESH_TOKEN_TTL) },
  ]);
  if (error) throw error;

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("oauth_grants")
    .update({ expires_at: inSeconds(REFRESH_TOKEN_TTL), last_used_at: now })
    .eq("id", grant.id);
  await supabaseAdmin.from("oauth_clients").update({ last_used_at: now }).eq("id", grant.client_id);

  // Opruimen terwijl we er toch zijn: verlopen tokens hebben geen functie meer.
  await supabaseAdmin
    .from("oauth_tokens")
    .delete()
    .lt("expires_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: (grant.scopes || SUPPORTED_SCOPES).join(" "),
  };
}

function pkceMatches(verifier, challenge) {
  if (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export async function exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier }) {
  const result = await consumeToken(code, "code");
  if (result.error) return { error: "invalid_grant", description: "Code ongeldig, verlopen of al gebruikt" };
  const { token, grant } = result;

  if (clientId && clientId !== grant.client_id) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "Code hoort bij een andere client" };
  }
  if (token.redirect_uri !== redirectUri) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "redirect_uri komt niet overeen" };
  }
  if (!pkceMatches(codeVerifier, token.code_challenge)) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "PKCE-verificatie mislukt" };
  }
  if (!(await loadActiveUser(grant.user_id))) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "Gebruiker is niet (meer) actief" };
  }
  return { tokens: await issueTokenPair(grant) };
}

export async function exchangeRefreshToken({ refreshToken, clientId }) {
  const result = await consumeToken(refreshToken, "refresh");
  if (result.error) return { error: "invalid_grant", description: "Refresh token ongeldig, verlopen of ingetrokken" };
  const { grant } = result;
  if (clientId && clientId !== grant.client_id) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "Token hoort bij een andere client" };
  }
  if (!(await loadActiveUser(grant.user_id))) {
    await revokeGrant(grant.id);
    return { error: "invalid_grant", description: "Gebruiker is niet (meer) actief" };
  }
  return { tokens: await issueTokenPair(grant) };
}

/** RFC 7009: onbekende tokens zijn geen fout. */
export async function revokeByToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string" || rawToken.length > 200) return;
  const { data } = await supabaseAdmin
    .from("oauth_tokens")
    .select("grant_id, kind")
    .eq("token_hash", hashToken(rawToken))
    .in("kind", ["access", "refresh"])
    .maybeSingle();
  if (data) await revokeGrant(data.grant_id);
}

export async function loadActiveUser(userId) {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id, name, email, role, must_change_pin, organization_id, organizations(id, slug, display_name)")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data?.organizations?.slug) return null;
  return data;
}

/**
 * Bearer token uit een MCP-verzoek → { user, tenant, grant } of null.
 * Leest de gebruiker elke keer opnieuw: een gedeactiveerde gebruiker of een
 * verhuizing naar een andere organisatie geldt meteen, niet pas na een uur.
 */
export async function authenticateBearer(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/i);
  if (!match) return { present: header.length > 0, auth: null, unknown: header.length > 0 };

  const { data: token } = await supabaseAdmin
    .from("oauth_tokens")
    .select("id, grant_id, expires_at, revoked_at, oauth_grants(id, user_id, client_id, scopes, revoked_at, last_used_at)")
    .eq("token_hash", hashToken(match[1]))
    .eq("kind", "access")
    .maybeSingle();
  // Alleen onbekende tokens tellen als gokpoging; een verlopen of ingetrokken
  // token is normaal verkeer vlak voor een refresh.
  if (!token) return { present: true, auth: null, unknown: true };
  if (token.revoked_at || token.oauth_grants?.revoked_at) return { present: true, auth: null };
  if (new Date(token.expires_at) < new Date()) return { present: true, auth: null };

  const user = await loadActiveUser(token.oauth_grants.user_id);
  if (!user || user.must_change_pin) return { present: true, auth: null };

  // last_used_at hoeft niet per request exact; eens per minuut is genoeg.
  const lastUsed = token.oauth_grants.last_used_at ? new Date(token.oauth_grants.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    await supabaseAdmin
      .from("oauth_grants")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", token.grant_id);
  }

  return {
    present: true,
    auth: {
      grant: token.oauth_grants,
      user,
      tenant: user.organizations.slug,
      scopes: token.oauth_grants.scopes || [],
    },
  };
}

/** Actieve koppelingen van één gebruiker (voor /mcp en het adminoverzicht). */
export async function listGrants({ userIds }) {
  const { data, error } = await supabaseAdmin
    .from("oauth_grants")
    .select("id, user_id, scopes, created_at, last_used_at, expires_at, oauth_clients(client_name)")
    .in("user_id", userIds)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .not("last_used_at", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((g) => ({
    id: g.id,
    user_id: g.user_id,
    client_name: g.oauth_clients?.client_name || "Onbekende client",
    scopes: g.scopes,
    created_at: g.created_at,
    last_used_at: g.last_used_at,
    expires_at: g.expires_at,
  }));
}
