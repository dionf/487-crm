import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRedirect, createGrantWithCode, validateAuthorizeRequest } from "@/lib/oauth";
import {
  attachRateLimitHeaders,
  enforceRateLimit,
  getBlock,
  getClientIp,
  RATE_LIMIT_POLICIES,
  registerFailedAttempt,
  resetRateLimit,
  timingSafeCompare,
  tooManyRequests,
} from "@/lib/rate-limit";

const SCOPE = "/api/oauth/authorize";
const PIN_RE = /^\d{4,6}$/;
const EMAIL_RE = /^[^\s@]{1,100}@[^\s@]{1,100}$/;

export const dynamic = "force-dynamic";

// POST /api/oauth/authorize — de inlogpagina (/oauth/authorize) stuurt hier
// e-mail + pincode heen. Bij succes krijgt de browser de redirect-URL terug
// met een eenmalige code voor Claude.
//
// Zelfde bescherming als /api/auth/verify-pin, met dezelfde tellers: wie hier
// pincodes gokt, loopt tegen dezelfde IP- en accountlockout aan als in de app.
export async function POST(request) {
  const ip = getClientIp(request);
  const ipGate = await enforceRateLimit({ request, policy: "auth-pin-ip", identifier: ip, scope: SCOPE });
  if (ipGate.response) return ipGate.response;

  const respond = (body, status = 200) =>
    attachRateLimitHeaders(NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }), ipGate.headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Ongeldige aanvraag" }, 400);
  }

  const params = body?.params && typeof body.params === "object" ? body.params : {};
  const check = await validateAuthorizeRequest(params);
  if (check.error) return respond({ error: check.error }, 400);
  if (check.redirectError) {
    return respond({
      redirect: buildRedirect(params.redirect_uri, {
        error: check.redirectError,
        error_description: check.redirectDescription,
        state: params.state,
      }),
    });
  }

  if (body.decision === "deny") {
    return respond({
      redirect: buildRedirect(params.redirect_uri, { error: "access_denied", state: params.state }),
    });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!EMAIL_RE.test(email) || !PIN_RE.test(pin)) {
    return respond({ error: "Onjuiste e-mail of pincode" }, 401);
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id, name, pin_hash, must_change_pin, organizations(slug, display_name)")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  // Lockout per account; bij een onbekend adres per e-mailadres, zodat ook
  // dat pad niet onbeperkt te proberen is.
  const lockId = user?.id || `email:${email}`;
  const block = await getBlock("auth-pin-user", lockId);
  if (block) return tooManyRequests(block.retryAfter, { "X-Lockout-Reason": "too-many-pin-attempts" });

  const pinHash = createHash("sha256").update(pin).digest("hex");
  if (!user || !user.pin_hash || !timingSafeCompare(user.pin_hash, pinHash)) {
    const locked = await registerFailedAttempt({
      request,
      policy: "auth-pin-user",
      identifier: lockId,
      scope: SCOPE,
      reason: user ? "Onjuiste pincode (MCP-koppeling)" : "Onbekend e-mailadres (MCP-koppeling)",
    });
    if (locked) {
      const lock = await getBlock("auth-pin-user", lockId);
      return tooManyRequests(lock?.retryAfter || RATE_LIMIT_POLICIES["auth-pin-user"].blockSeconds, {
        "X-Lockout-Reason": "too-many-pin-attempts",
      });
    }
    return respond({ error: "Onjuiste e-mail of pincode" }, 401);
  }

  await resetRateLimit("auth-pin-user", lockId);

  if (user.must_change_pin) {
    return respond(
      { error: "Je moet eerst je startpincode wijzigen. Log in op het CRM, kies een eigen pincode en probeer het daarna opnieuw." },
      403
    );
  }
  if (!user.organizations?.slug) return respond({ error: "Je account hoort niet bij een organisatie" }, 403);

  const code = await createGrantWithCode({
    userId: user.id,
    clientId: check.client.id,
    scopes: check.scopes,
    codeChallenge: params.code_challenge,
    redirectUri: params.redirect_uri,
  });

  return respond({ redirect: buildRedirect(params.redirect_uri, { code, state: params.state }) });
}
