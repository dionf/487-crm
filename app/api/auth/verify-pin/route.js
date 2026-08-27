import { supabaseAdmin } from "@/lib/supabase-admin";
import { createHash } from "crypto";
import { signToken } from "@/lib/auth";
import {
  attachRateLimitHeaders,
  enforceRateLimit,
  getBlock,
  getClientIp,
  RATE_LIMIT_POLICIES,
  recordAbuse,
  registerFailedAttempt,
  resetRateLimit,
  timingSafeCompare,
  tooManyRequests,
} from "@/lib/rate-limit";
import { NextResponse } from "next/server";

const COOKIE_NAME = "crm-auth";
const SCOPE = "/api/auth/verify-pin";

// De UI accepteert 4 tot 6 cijfers. Alles daarbuiten kan geen geldige pincode
// zijn, dus dat weigeren we vóór de database-lookup: scheelt een query per
// gokpoging en houdt onzin-payloads uit de rest van de route.
const PIN_RE = /^\d{4,6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";

// POST /api/auth/verify-pin — verify user pin and set auth cookie
//
// Dit is het enige endpoint waar een buitenstaander met raden binnenkomt: de
// pincode is 4-6 cijfers, dus zonder teller loopt een bot de hele ruimte in
// minuten af. Daarom drie lagen:
//   - per IP: houdt één bron tegen die veel accounts probeert
//   - per gebruiker: houdt een verspreide aanval op één account tegen
//   - progressieve lockout: herhaling kost exponentieel meer wachttijd
// De tellers staan in Postgres (migratie 030), niet in het geheugen van de
// serverless-instantie — anders ontsnapt een aanvaller door verbindingen te
// spreiden over instanties.
export async function POST(request) {
  const ip = getClientIp(request);

  const ipGate = await enforceRateLimit({
    request,
    policy: "auth-pin-ip",
    identifier: ip,
    scope: SCOPE,
  });
  if (ipGate.response) return ipGate.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return attachRateLimitHeaders(
      Response.json({ error: "Ongeldige aanvraag" }, { status: 400 }),
      ipGate.headers
    );
  }

  const user_id = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";

  if (!user_id || !pin) {
    return attachRateLimitHeaders(
      Response.json({ error: "user_id and pin are required" }, { status: 400 }),
      ipGate.headers
    );
  }

  if (!UUID_RE.test(user_id) || !PIN_RE.test(pin)) {
    await recordAbuse({
      request,
      scope: SCOPE,
      policy: "auth-pin-ip",
      reason: "Ongeldig formaat voor user_id of pincode",
      identifier: ip,
    });
    return attachRateLimitHeaders(
      Response.json({ error: "Onjuiste pincode" }, { status: 401 }),
      ipGate.headers
    );
  }

  // Lockout op accountniveau: staat los van de IP-teller, zodat een aanval die
  // over veel adressen wordt verspreid alsnog op één account stukloopt.
  const userBlock = await getBlock("auth-pin-user", user_id);
  if (userBlock) {
    return tooManyRequests(userBlock.retryAfter, {
      "X-Lockout-Reason": "too-many-pin-attempts",
    });
  }

  // Hash the provided pin
  const pinHash = createHash("sha256").update(pin).digest("hex");

  // Fetch user with org info
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, phone, role, organization_id, pin_hash, organizations(id, slug, display_name, pipeline_stages, service_types, theme)")
    .eq("id", user_id)
    .eq("is_active", true)
    .single();

  const failedLogin = async (reason) => {
    const locked = await registerFailedAttempt({
      request,
      policy: "auth-pin-user",
      identifier: user_id,
      scope: SCOPE,
      reason,
    });
    if (locked) {
      const block = await getBlock("auth-pin-user", user_id);
      return tooManyRequests(block?.retryAfter || RATE_LIMIT_POLICIES["auth-pin-user"].blockSeconds, {
        "X-Lockout-Reason": "too-many-pin-attempts",
      });
    }
    // Zelfde melding voor "gebruiker bestaat niet" en "pincode klopt niet".
    // De gebruikerslijst is al publiek, maar er is geen reden om via dit
    // endpoint te bevestigen welk id wél bestaat.
    return attachRateLimitHeaders(
      Response.json({ error: "Onjuiste pincode" }, { status: 401 }),
      ipGate.headers
    );
  };

  if (error || !user) {
    return failedLogin("Pincode geprobeerd op onbekend of inactief account");
  }

  // Vergelijking van constante duur: een gewone === lekt via responsetijd hoe
  // ver de gok naast zat.
  if (!user.pin_hash || !timingSafeCompare(user.pin_hash, pinHash)) {
    return failedLogin("Onjuiste pincode");
  }

  // Geslaagd: alleen de faalteller van dit account wissen, zodat een enkele
  // typefout niet meetelt richting de lockout van morgen.
  //
  // De IP-teller blijft bewust staan. Die telt élke verificatiepoging, niet
  // alleen de mislukte, en is daarmee het enige plafond op het totale volume
  // vanaf één bron. Wie hem bij een geslaagde login zou wissen, geeft iemand
  // die één pincode kent een gratis reset: negentien gokken op andere accounts,
  // dan inloggen op het eigen account, en de teller staat weer op nul.
  await resetRateLimit("auth-pin-user", user_id);

  // Create JWT payload
  const tokenPayload = {
    user_id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant: user.organizations.slug,
    org_id: user.organizations.id,
  };

  const token = await signToken(tokenPayload);

  // Build session data for client (UI state)
  const sessionData = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || null,
      role: user.role,
    },
    organization: user.organizations,
    tenant: user.organizations.slug,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  // Set httpOnly cookie with JWT and return session data for UI
  const response = NextResponse.json({ success: true, session: sessionData });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h
  });

  return response;
}
