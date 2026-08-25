/**
 * In-memory rate limiter zonder dependencies — geschikt voor de Edge-middleware.
 *
 * De middleware draait vóór elke /api/*-request. Een database-round-trip per
 * request zou daar tientallen milliseconden kosten aan verkeer dat vrijwel
 * altijd legitiem is. Deze laag vangt daarom uitsluitend het volumetrische deel
 * af: bursts. Dat is precies de vorm die brute force en massale probing hebben —
 * honderden requests per minuut vanaf hetzelfde adres.
 *
 * Beperking, bewust geaccepteerd: op Vercel heeft elke instantie zijn eigen
 * geheugen, dus een aanvaller die over instanties spreidt telt per instantie.
 * De duurzame teller in Postgres (lib/rate-limit.js) vangt dat op voor de
 * endpoints waar het echt om gaat. Zie docs/rate-limiting.md.
 */

const counters = new Map();
const blocks = new Map();

// Plafond op het aantal bijgehouden sleutels. Een aanvaller die per request een
// nieuw IP spooft mag het geheugen van de instantie niet kunnen opblazen.
const MAX_KEYS = 20000;

function prune(map, now) {
  for (const [key, entry] of map) {
    if (entry.expiresAt <= now) map.delete(key);
  }
  if (map.size <= MAX_KEYS) return;
  // Nog steeds te groot: gooi de oudste helft weg. Liever te soepel meten dan
  // onbeperkt geheugen vasthouden.
  const sorted = [...map.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i < Math.ceil(sorted.length / 2); i++) map.delete(sorted[i][0]);
}

/**
 * Haalt het client-IP uit de proxy-headers.
 *
 * Op Vercel is `x-forwarded-for` door de edge gezet en is het eerste adres de
 * echte client. Buiten Vercel kan die header gespooft zijn; daarom wint
 * `x-vercel-forwarded-for` als die bestaat.
 */
export function getClientIp(request) {
  const headers = request.headers;
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-real-ip"),
    headers.get("cf-connecting-ip"),
    headers.get("x-forwarded-for"),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return request.ip || "unknown";
}

/**
 * Telt één poging af tegen een vast venster in het geheugen.
 * Retourneert { allowed, hits, remaining, retryAfter, resetAt }.
 */
export function consumeMemoryLimit(key, limit, windowSeconds, cost = 1) {
  const now = Date.now();
  if (counters.size > MAX_KEYS / 2) prune(counters, now);

  let entry = counters.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { hits: 0, expiresAt: now + windowSeconds * 1000 };
    counters.set(key, entry);
  }
  entry.hits += cost;

  const allowed = entry.hits <= limit;
  return {
    allowed,
    hits: entry.hits,
    remaining: Math.max(limit - entry.hits, 0),
    retryAfter: allowed ? 0 : Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1),
    resetAt: entry.expiresAt,
  };
}

/** Wist een teller, bv. na een geslaagde login. */
export function resetMemoryLimit(key) {
  counters.delete(key);
}

/**
 * Zet een tijdelijke blokkade. Herhaling verdubbelt de duur (tot 6 uur), zodat
 * een bot die na afloop meteen doorgaat steeds langer buiten staat.
 */
export function blockMemory(key, seconds, reason) {
  const now = Date.now();
  const previous = blocks.get(key);
  const strikes = previous && previous.expiresAt > now - 3600_000 ? previous.strikes + 1 : 1;
  const duration = Math.min(seconds * 2 ** Math.min(strikes - 1, 5), 21600) * 1000;
  const entry = { expiresAt: Math.max(now + duration, previous?.expiresAt || 0), strikes, reason };
  if (blocks.size > MAX_KEYS / 2) prune(blocks, now);
  blocks.set(key, entry);
  return entry;
}

/** Actieve blokkade opvragen; null als de sleutel vrij is. */
export function memoryBlockStatus(key) {
  const entry = blocks.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now) {
    blocks.delete(key);
    return null;
  }
  return {
    retryAfter: Math.max(Math.ceil((entry.expiresAt - now) / 1000), 1),
    reason: entry.reason,
    strikes: entry.strikes,
  };
}

/** Standaard RateLimit-headers (draft-7 stijl) plus Retry-After. */
export function rateLimitHeaders({ limit, remaining = 0, retryAfter = 0, resetAt }) {
  const headers = {};
  if (typeof limit === "number") headers["RateLimit-Limit"] = String(limit);
  headers["RateLimit-Remaining"] = String(Math.max(remaining, 0));
  const resetSeconds =
    typeof resetAt === "number"
      ? Math.max(Math.ceil((resetAt - Date.now()) / 1000), 0)
      : retryAfter;
  headers["RateLimit-Reset"] = String(resetSeconds);
  if (retryAfter > 0) headers["Retry-After"] = String(retryAfter);
  return headers;
}

/** Uniforme 429 zonder detail over welke teller precies is geraakt. */
export function tooManyRequests(retryAfter, extraHeaders = {}) {
  return Response.json(
    { error: "Te veel verzoeken. Probeer het later opnieuw.", retry_after: retryAfter },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders({ retryAfter }),
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    }
  );
}
