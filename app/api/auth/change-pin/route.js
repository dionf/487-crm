import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "crypto";
import { getAuthCookie, setAuthCookie, signToken, verifyToken } from "@/lib/auth";
import {
  attachRateLimitHeaders,
  enforceRateLimit,
  getBlock,
  getClientIp,
  RATE_LIMIT_POLICIES,
  registerFailedAttempt,
  timingSafeCompare,
  tooManyRequests,
} from "@/lib/rate-limit";
import { NextResponse } from "next/server";

const SCOPE = "/api/auth/change-pin";
const PIN_RE = /^\d{4,6}$/;

export const dynamic = "force-dynamic";

// POST /api/auth/change-pin — ingelogde gebruiker kiest een nieuwe pincode
//
// Valt onder /api/auth/ en is daarmee publiek voor de middleware: die laat
// tijdens een verplichte pinwijziging bewust geen enkele beschermde route door.
// Deze route verifieert de cookie daarom zelf.
//
// Twee situaties:
//   - verplichte wijziging (claim pin_change_required in het JWT én de vlag
//     must_change_pin nog aan in de database): de gebruiker heeft zojuist met de
//     startpincode ingelogd, dus die vragen we niet nog eens
//   - vrijwillige wijziging: huidige pincode verplicht, met dezelfde lockout als
//     de login, zodat een gestolen sessie de pincode niet kan overnemen
export async function POST(request) {
  const ip = getClientIp(request);

  const ipGate = await enforceRateLimit({
    request,
    policy: "auth-pin-ip",
    identifier: ip,
    scope: SCOPE,
  });
  if (ipGate.response) return ipGate.response;

  const reply = (payload, status) =>
    attachRateLimitHeaders(Response.json(payload, { status }), ipGate.headers);

  const token = getAuthCookie(request);
  const session = token ? await verifyToken(token) : null;
  if (!session) return reply({ error: "Niet ingelogd" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Ongeldige aanvraag" }, 400);
  }

  const newPin = typeof body?.new_pin === "string" ? body.new_pin.trim() : "";
  const currentPin = typeof body?.current_pin === "string" ? body.current_pin.trim() : "";

  if (!PIN_RE.test(newPin)) {
    return reply({ error: "Kies een pincode van 4 tot 6 cijfers" }, 400);
  }

  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, phone, role, pin_hash, must_change_pin, organizations(id, slug, display_name, pipeline_stages, service_types, theme)")
    .eq("id", session.user_id)
    .eq("is_active", true)
    .single();

  if (error || !user) return reply({ error: "Niet ingelogd" }, 401);

  // De claim alleen is niet genoeg: het JWT blijft 24 uur geldig, ook nadat de
  // pincode al is gewijzigd. Een gekopieerde startsessie zou dan zonder huidige
  // pincode de nieuwe pincode kunnen overschrijven. De vlag in de database is
  // de eenmalige autorisatie; die wordt hieronder atomair verbruikt.
  const forced = session.pin_change_required === true && user.must_change_pin === true;

  if (!forced) {
    const userBlock = await getBlock("auth-pin-user", user.id);
    if (userBlock) {
      return tooManyRequests(userBlock.retryAfter, {
        "X-Lockout-Reason": "too-many-pin-attempts",
      });
    }

    const currentHash = createHash("sha256").update(currentPin).digest("hex");
    if (!PIN_RE.test(currentPin) || !timingSafeCompare(user.pin_hash, currentHash)) {
      const locked = await registerFailedAttempt({
        request,
        policy: "auth-pin-user",
        identifier: user.id,
        scope: SCOPE,
        reason: "Onjuiste huidige pincode bij pinwijziging",
      });
      if (locked) {
        const block = await getBlock("auth-pin-user", user.id);
        return tooManyRequests(block?.retryAfter || RATE_LIMIT_POLICIES["auth-pin-user"].blockSeconds, {
          "X-Lockout-Reason": "too-many-pin-attempts",
        });
      }
      return reply({ error: "Huidige pincode is onjuist" }, 401);
    }
  }

  const newHash = createHash("sha256").update(newPin).digest("hex");
  if (timingSafeCompare(user.pin_hash, newHash)) {
    return reply({ error: "Kies een andere pincode dan je huidige" }, 400);
  }

  // Verplichte wijziging: alleen slagen zolang de vlag nog aan staat. Twee
  // gelijktijdige requests met dezelfde startsessie kunnen zo niet allebei
  // winnen; de tweede raakt nul rijen.
  let update = supabaseAdmin
    .from("users")
    .update({ pin_hash: newHash, must_change_pin: false })
    .eq("id", user.id);
  if (forced) update = update.eq("must_change_pin", true);

  const { data: updated, error: updateError } = await update.select("id");

  if (updateError) return reply({ error: "Pincode opslaan mislukt" }, 500);
  if (!updated?.length) {
    return reply({ error: "Je pincode is al gewijzigd. Log opnieuw in." }, 409);
  }

  // Nieuw JWT zonder de claim pin_change_required, anders blijft de middleware
  // de sessie tegenhouden tot de oude cookie verloopt.
  const newToken = await signToken({
    user_id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant: user.organizations.slug,
    org_id: user.organizations.id,
  });

  const response = NextResponse.json({
    success: true,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        role: user.role,
      },
      organization: user.organizations,
      tenant: user.organizations.slug,
      must_change_pin: false,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  setAuthCookie(response, newToken);
  return attachRateLimitHeaders(response, ipGate.headers);
}
