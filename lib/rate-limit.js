/**
 * Duurzame rate limiting en anti-abuse voor de API-routes (Node-runtime).
 *
 * Waarom niet alleen de in-memory laag uit lib/rate-limit-edge.js: op Vercel
 * heeft elke serverless-instantie zijn eigen geheugen. Een brute-forcer die
 * verbindingen spreidt krijgt dan per instantie een verse teller. Voor de
 * endpoints waar een enkele geslaagde poging al schade oplevert — pincode,
 * offerte-hashes, cron-secret — telt daarom Postgres mee (migratie 030), met
 * atomaire upserts zodat gelijktijdige requests niet langs elkaar heen tellen.
 *
 * Volgorde per beschermd endpoint:
 *   1. blokkade actief?           → 429, geen verder werk
 *   2. teller ophogen             → over de limiet? blokkade zetten + 429
 *   3. route doet zijn werk
 *   4. mislukte poging?           → aparte "failure"-teller ophogen
 *   5. geslaagde poging?          → failure-teller wissen
 *
 * Faalgedrag: als Supabase onbereikbaar is vallen we terug op de in-memory
 * teller van deze instantie. Liever iets te soepel meten dan de hele login
 * platleggen omdat de teller-tabel hapert.
 */

import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  consumeMemoryLimit,
  getClientIp,
  rateLimitHeaders,
  resetMemoryLimit,
  tooManyRequests,
} from "@/lib/rate-limit-edge";

export { getClientIp, rateLimitHeaders, tooManyRequests };

/**
 * Beleidsregels op één plek, zodat limieten reviewbaar zijn zonder door de
 * routes te grepen. `blockSeconds: 0` betekent: wel 429, geen strafblokkade.
 */
export const RATE_LIMIT_POLICIES = {
  // Pincode-login. Kort en numeriek, dus de aantrekkelijkste brute-force-target.
  // Per IP ruim genoeg voor een kantoor achter één NAT-adres, per gebruiker
  // strak genoeg dat de pinruimte niet af te lopen is.
  "auth-pin-ip": { limit: 20, windowSeconds: 300, blockSeconds: 900 },
  "auth-pin-user": { limit: 5, windowSeconds: 900, blockSeconds: 900 },

  // Gebruikers-/organisatielijsten op het startscherm: publiek, dus bruikbaar
  // om accounts te enumereren voordat de brute force begint.
  "auth-directory": { limit: 60, windowSeconds: 300, blockSeconds: 900 },

  // Publieke intake. De bestaande per-e-mailteller blijft; deze vangt de bot
  // af die per inzending een nieuw adres verzint.
  "public-intake-ip": { limit: 10, windowSeconds: 3600, blockSeconds: 3600 },
  "public-intake-email": { limit: 5, windowSeconds: 3600, blockSeconds: 0 },

  // Publieke offerte-hashes en trackingpixels. Normale bezoekers openen één
  // hash een paar keer; een bot loopt de ruimte af en produceert vooral missers.
  "public-hash": { limit: 120, windowSeconds: 600, blockSeconds: 0 },
  "public-hash-miss": { limit: 12, windowSeconds: 600, blockSeconds: 3600 },

  // Cron-endpoints met een bearer-secret: elk mislukt secret is een gokpoging.
  "cron-secret-miss": { limit: 5, windowSeconds: 3600, blockSeconds: 3600 },

  // Ingelogde gebruikers. Ruim voor de UI, maar het maakt een gestolen sessie
  // ongeschikt om in bulk de hele database leeg te trekken.
  "session-read": { limit: 600, windowSeconds: 60, blockSeconds: 0 },
  "session-search": { limit: 90, windowSeconds: 60, blockSeconds: 0 },
  "session-write": { limit: 120, windowSeconds: 60, blockSeconds: 0 },
  "session-expensive": { limit: 20, windowSeconds: 300, blockSeconds: 0 },
};

const SALT = process.env.RATE_LIMIT_SALT || process.env.JWT_SECRET || "487crm-rate-limit";

/**
 * Identifiers (IP, e-mail, user-id) worden gehasht voordat ze de tellertabel in
 * gaan. De teller hoeft niet te weten wíé er telt, alleen dát het dezelfde is —
 * en zo staan er geen adressen in een tabel die alleen maar hoeft te tellen.
 */
function bucketKey(policy, identifier) {
  const digest = createHash("sha256").update(`${SALT}:${policy}:${identifier}`).digest("hex");
  return `${policy}:${digest.slice(0, 40)}`;
}

function policyConfig(policy, overrides = {}) {
  const base = RATE_LIMIT_POLICIES[policy];
  if (!base) throw new Error(`Onbekend rate-limit beleid: ${policy}`);
  return { ...base, ...overrides };
}

/** Vervangt === op geheimen door een vergelijking van constante duur. */
export function timingSafeCompare(a, b) {
  const bufA = Buffer.from(String(a ?? ""), "utf8");
  const bufB = Buffer.from(String(b ?? ""), "utf8");
  // timingSafeEqual eist gelijke lengte; hash eerst zodat de lengte zelf niets
  // verklapt en de vergelijking altijd even lang duurt.
  const hashA = createHash("sha256").update(bufA).digest();
  const hashB = createHash("sha256").update(bufB).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Legt geweigerd verkeer vast. Mag de request nooit laten struikelen: een
 * kapotte auditlog is geen reden om een legitieme bezoeker te blokkeren.
 */
export async function recordAbuse({
  request,
  scope,
  policy,
  reason,
  tenant = null,
  identifier = null,
  details = null,
}) {
  try {
    const url = request ? new URL(request.url) : null;
    await supabaseAdmin.from("api_abuse_events").insert({
      scope: String(scope).slice(0, 200),
      policy: policy ? String(policy).slice(0, 100) : null,
      reason: reason ? String(reason).slice(0, 500) : null,
      path: url ? url.pathname.slice(0, 300) : null,
      method: request?.method || null,
      tenant: tenant ? String(tenant).slice(0, 50) : null,
      // Alleen een korte hash: genoeg om herhaling te herkennen, geen
      // persoonsgegeven in de log.
      identifier: identifier
        ? createHash("sha256").update(`${SALT}:${identifier}`).digest("hex").slice(0, 16)
        : null,
      ip_address: request ? getClientIp(request).slice(0, 64) : null,
      user_agent: (request?.headers.get("user-agent") || "").slice(0, 300) || null,
      details,
    });
  } catch (err) {
    console.error("Kon abuse-event niet loggen:", err?.message || err);
  }
}

/**
 * Housekeeping zonder extra cron-endpoint: ongeveer één op de duizend
 * beschermde requests ruimt verlopen tellers, blokkades en abuse-events op.
 * De tabellen groeien per unieke identifier, niet per request, dus dit is ruim
 * genoeg — en het scheelt een publiek endpoint dat zelf weer beschermd moet.
 */
let pruneInFlight = false;
function maybePrune() {
  if (pruneInFlight || Math.random() > 0.001) return;
  pruneInFlight = true;
  supabaseAdmin
    .rpc("prune_rate_limit_state")
    .then(({ error }) => {
      if (error) console.error("prune_rate_limit_state faalde:", error.message || error);
    })
    .catch((err) => console.error("prune_rate_limit_state faalde:", err?.message || err))
    .finally(() => {
      pruneInFlight = false;
    });
}

async function rpc(fn, args) {
  const { data, error } = await supabaseAdmin.rpc(fn, args);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

/** Actieve blokkade voor deze sleutel, of null. */
export async function getBlock(policy, identifier) {
  const key = bucketKey(policy, identifier);
  try {
    const row = await rpc("rate_limit_block_status", { p_key: key });
    if (!row) return null;
    return { retryAfter: row.retry_after, reason: row.reason, strikes: row.strikes };
  } catch (err) {
    console.error("rate_limit_block_status faalde:", err?.message || err);
    return null;
  }
}

/** Zet of verlengt een blokkade voor deze sleutel. */
export async function registerBlock(policy, identifier, seconds, reason, scope) {
  const key = bucketKey(policy, identifier);
  try {
    const row = await rpc("register_rate_limit_block", {
      p_key: key,
      p_seconds: seconds,
      p_reason: reason || null,
      p_scope: scope || null,
    });
    return row ? { blockedUntil: row.blocked_until, strikes: row.strikes } : null;
  } catch (err) {
    console.error("register_rate_limit_block faalde:", err?.message || err);
    return null;
  }
}

/** Wist tellers én blokkade, bv. na een geslaagde login. */
export async function resetRateLimit(policy, identifier) {
  const key = bucketKey(policy, identifier);
  resetMemoryLimit(key);
  try {
    await supabaseAdmin.rpc("reset_rate_limit", { p_keys: [key] });
  } catch (err) {
    console.error("reset_rate_limit faalde:", err?.message || err);
  }
}

/**
 * Hoogt een teller op en zegt of de poging nog binnen het beleid valt.
 * Valt bij een DB-fout terug op de in-memory teller van deze instantie.
 */
export async function consumeRateLimit(policy, identifier, overrides = {}) {
  const { limit, windowSeconds } = policyConfig(policy, overrides);
  const key = bucketKey(policy, identifier);
  const cost = overrides.cost ?? 1;

  maybePrune();

  try {
    const row = await rpc("consume_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_cost: cost,
    });
    if (row) {
      return {
        allowed: row.allowed,
        hits: row.hits,
        remaining: row.remaining,
        retryAfter: row.retry_after,
        limit,
        degraded: false,
      };
    }
  } catch (err) {
    console.error(`consume_rate_limit (${policy}) faalde:`, err?.message || err);
  }

  const fallback = consumeMemoryLimit(key, limit, windowSeconds, cost);
  return { ...fallback, limit, degraded: true };
}

/**
 * De gebruikelijke poort aan het begin van een beschermde route.
 *
 * Retourneert een Response (429) wanneer de aanroeper geweerd moet worden, en
 * anders null. De headers van de gelukte meting geef je desgewenst mee aan het
 * echte antwoord via `attachRateLimitHeaders`.
 */
export async function enforceRateLimit({
  request,
  policy,
  identifier,
  scope,
  tenant = null,
  cost = 1,
  overrides = {},
}) {
  const config = policyConfig(policy, overrides);

  const block = await getBlock(policy, identifier);
  if (block) {
    return {
      response: tooManyRequests(block.retryAfter),
      headers: rateLimitHeaders({ limit: config.limit, remaining: 0, retryAfter: block.retryAfter }),
      blocked: true,
    };
  }

  const result = await consumeRateLimit(policy, identifier, { ...overrides, cost });
  const headers = rateLimitHeaders({
    limit: result.limit,
    remaining: result.remaining,
    retryAfter: result.allowed ? 0 : result.retryAfter,
  });

  if (result.allowed) return { response: null, headers, blocked: false, result };

  let retryAfter = result.retryAfter;
  if (config.blockSeconds > 0) {
    const registered = await registerBlock(
      policy,
      identifier,
      config.blockSeconds,
      `Limiet ${config.limit}/${config.windowSeconds}s overschreden`,
      scope
    );
    if (registered?.blockedUntil) {
      retryAfter = Math.max(
        Math.ceil((new Date(registered.blockedUntil).getTime() - Date.now()) / 1000),
        1
      );
    }
  }

  await recordAbuse({
    request,
    scope,
    policy,
    reason: `Limiet overschreden (${result.hits}/${config.limit} per ${config.windowSeconds}s)`,
    tenant,
    identifier,
    details: { hits: result.hits, degraded: result.degraded },
  });

  return {
    response: tooManyRequests(retryAfter),
    headers: rateLimitHeaders({ limit: config.limit, remaining: 0, retryAfter }),
    blocked: true,
    result,
  };
}

/**
 * Registreert een mislukte poging (verkeerde pincode, onbekende hash, fout
 * cron-secret) en blokkeert zodra het patroon niet meer op vergissingen lijkt.
 * Retourneert true als de aanroeper nu geblokkeerd is.
 */
export async function registerFailedAttempt({
  request,
  policy,
  identifier,
  scope,
  tenant = null,
  reason,
}) {
  const config = policyConfig(policy);
  const result = await consumeRateLimit(policy, identifier);
  if (result.allowed) return false;

  if (config.blockSeconds > 0) {
    await registerBlock(policy, identifier, config.blockSeconds, reason || "Te veel mislukte pogingen", scope);
  }
  await recordAbuse({
    request,
    scope,
    policy,
    reason: reason || `Te veel mislukte pogingen (${result.hits}/${config.limit})`,
    tenant,
    identifier,
    details: { hits: result.hits, degraded: result.degraded },
  });
  return true;
}

/** Plakt de rate-limit headers op een bestaand antwoord. */
export function attachRateLimitHeaders(response, headers) {
  if (!response || !headers) return response;
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Controleert het bearer-secret van de cron-endpoints.
 *
 * Twee verbeteringen ten opzichte van `header === \`Bearer ${SECRET}\``:
 * de vergelijking duurt altijd even lang, en een fout secret telt mee als
 * gokpoging. Deze endpoints doen zwaar werk (IMAP-polling, nieuwsbrieven
 * verzenden), dus ze zijn de moeite waard om te raden.
 *
 * Retourneert { presented, valid, response }. `presented: false` betekent dat er
 * helemaal geen bearer is meegestuurd — dan is het een handmatige trigger door
 * een ingelogde gebruiker en moet de route zijn eigen sessiecontrole doen.
 * Als `response` gevuld is, moet de route die direct teruggeven.
 */
export async function verifyCronBearer(request, scope) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { presented: false, valid: false, response: null };
  }

  const ip = getClientIp(request);
  const block = await getBlock("cron-secret-miss", ip);
  if (block) {
    return { presented: true, valid: false, response: tooManyRequests(block.retryAfter) };
  }

  const secret = process.env.CRON_SECRET;
  if (secret && timingSafeCompare(header.slice(7), secret)) {
    return { presented: true, valid: true, response: null };
  }

  const blocked = await registerFailedAttempt({
    request,
    policy: "cron-secret-miss",
    identifier: ip,
    scope,
    reason: "Onjuist cron-secret aangeboden",
  });
  if (blocked) {
    const active = await getBlock("cron-secret-miss", ip);
    return {
      presented: true,
      valid: false,
      response: tooManyRequests(active?.retryAfter || RATE_LIMIT_POLICIES["cron-secret-miss"].blockSeconds),
    };
  }
  return { presented: true, valid: false, response: null };
}
