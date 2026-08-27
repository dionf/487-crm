import { NextResponse } from "next/server";
import { getAuthCookie, verifyToken } from "@/lib/auth";
import {
  blockMemory,
  consumeMemoryLimit,
  getClientIp,
  memoryBlockStatus,
  rateLimitHeaders,
} from "@/lib/rate-limit-edge";

// Routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/",         // Login flow
  "/api/poll-inbox",    // Cron job (has own CRON_SECRET auth)
  "/api/cron/newsletter-batches", // Cron job (has own CRON_SECRET auth)
  "/api/track/",        // Public tracking pixel
  "/api/public/",       // Public quote pages
  "/api/newsletter/webhook", // Resend webhook (Svix signature verified in route)
];

// Headers die alleen de middleware mag zetten. Een client die ze zelf meestuurt
// zou anders een sessie kunnen suggereren aan routes die getVerifiedSession()
// gebruiken; op publieke paden zette de middleware ze niet en werden ze ook niet
// verwijderd. Altijd strippen, daarna pas zelf zetten.
// Ondertekende webhooks. Hun authenticatie is de handtekening, niet het IP, en
// de afzender is één bekende dienst die legitiem in bursts levert: een
// nieuwsbriefbatch van 100 ontvangers (DEFAULT_BATCH_SIZE in lib/newsletters.js)
// produceert honderden events kort na elkaar. Die door de generieke IP-emmers
// duwen kost verloren bounce- en klachtevents — en dus mail naar adressen die
// al hard gebounced zijn.
const SIGNED_WEBHOOK_PATHS = ["/api/newsletter/webhook"];

const SERVER_ONLY_HEADERS = [
  "x-auth-user-id",
  "x-auth-tenant",
  "x-auth-role",
  "x-auth-name",
  "x-tenant",
];

/**
 * Grofmazige limieten aan de rand, per IP. Dit is de goedkope laag: hij vangt
 * bursts af zonder database-round-trip. De fijnmazige, instantie-overstijgende
 * tellers zitten in de routes zelf (lib/rate-limit.js).
 *
 * `burst` vangt de scanner die zo hard mogelijk gaat, `sustained` de bot die
 * netjes traag doorloopt maar uren blijft hameren.
 */
const EDGE_LIMITS = {
  burst: { limit: 60, windowSeconds: 10, blockSeconds: 60 },
  sustained: { limit: 600, windowSeconds: 300, blockSeconds: 300 },
  // Loginflow: startscherm haalt organisaties + gebruikers op, daarna pincode.
  auth: { limit: 40, windowSeconds: 60, blockSeconds: 300 },
  // Publieke formulieren, offertepagina's en trackingpixels.
  public: { limit: 90, windowSeconds: 60, blockSeconds: 300 },
  // Requests zonder geldige sessie op beschermde routes. Legitiem gebeurt dit
  // hooguit een paar keer (verlopen sessie in een open tabblad); in bulk is het
  // per definitie iemand die endpoints aan het aflopen is.
  probe: { limit: 20, windowSeconds: 600, blockSeconds: 1800 },
  // Ondertekende webhooks: ruim genoeg voor een campagne-burst, maar niet
  // ongelimiteerd — een request met een ongeldige handtekening kost een query
  // op newsletter_settings vóórdat hij wordt afgekeurd, dus helemaal vrijstellen
  // maakt het endpoint een gratis databasepomp. blockSeconds 0: een 429 zolang
  // de emmer vol is, nooit een strafperiode voor een legitieme afzender.
  webhook: { limit: 6000, windowSeconds: 60, blockSeconds: 0 },
};

function isPublicPath(pathname) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

function isSignedWebhook(pathname) {
  return SIGNED_WEBHOOK_PATHS.some((p) => pathname.startsWith(p));
}

function pathClass(pathname) {
  if (pathname.startsWith("/api/auth/")) return "auth";
  if (pathname.startsWith("/api/public/") || pathname.startsWith("/api/track/")) {
    return "public";
  }
  return null;
}

function limitResponse(retryAfter) {
  return NextResponse.json(
    { error: "Te veel verzoeken. Probeer het later opnieuw.", retry_after: retryAfter },
    { status: 429, headers: { ...rateLimitHeaders({ retryAfter }), "Cache-Control": "no-store" } }
  );
}

/**
 * Loopt de edge-limieten af voor dit IP. Retourneert een 429 zodra er één
 * overschreden is, anders null.
 */
function checkEdgeLimits(ip, pathname) {
  // Een ondertekende webhook telt alleen tegen zijn eigen emmer: de generieke
  // burst/sustained-emmers zijn gedimensioneerd op browserverkeer en een
  // campagne-burst gaat daar legitiem overheen.
  const buckets = isSignedWebhook(pathname) ? ["webhook"] : ["burst", "sustained"];
  if (!isSignedWebhook(pathname)) {
    const cls = pathClass(pathname);
    if (cls) buckets.push(cls);
  }

  for (const name of buckets) {
    const key = `edge:${name}:${ip}`;
    const blocked = memoryBlockStatus(key);
    if (blocked) return limitResponse(blocked.retryAfter);

    const config = EDGE_LIMITS[name];
    const result = consumeMemoryLimit(key, config.limit, config.windowSeconds);
    if (!result.allowed) {
      let retryAfter = result.retryAfter;
      if (config.blockSeconds > 0) {
        const block = blockMemory(key, config.blockSeconds, `edge-limiet ${name}`);
        retryAfter = Math.max(Math.ceil((block.expiresAt - Date.now()) / 1000), 1);
      }
      console.warn(`[rate-limit] edge-limiet ${name} geraakt voor ${ip} op ${pathname}`);
      return limitResponse(retryAfter);
    }
  }
  return null;
}

/**
 * Telt een request zonder geldige sessie mee en blokkeert het IP zodra er
 * duidelijk endpoints worden afgelopen in plaats van dat er één sessie is
 * verlopen. Retourneert de te sturen response (429 of 401).
 */
function handleUnauthenticated(ip, pathname, message) {
  const key = `edge:probe:${ip}`;
  const blocked = memoryBlockStatus(key);
  if (blocked) return limitResponse(blocked.retryAfter);

  const { limit, windowSeconds, blockSeconds } = EDGE_LIMITS.probe;
  const result = consumeMemoryLimit(key, limit, windowSeconds);
  if (!result.allowed) {
    const block = blockMemory(key, blockSeconds, "probing op beschermde API-routes");
    const retryAfter = Math.max(Math.ceil((block.expiresAt - Date.now()) / 1000), 1);
    console.warn(`[rate-limit] probing geblokkeerd voor ${ip} op ${pathname}`);
    return limitResponse(retryAfter);
  }

  return NextResponse.json(
    { error: message },
    {
      status: 401,
      headers: {
        ...rateLimitHeaders({ limit, remaining: result.remaining }),
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Only protect /api/* routes (pages are protected by PinGate client-side)
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const ip = getClientIp(request);

  // Volumetrische bescherming vóór al het andere: een geblokkeerd IP mag geen
  // database- of crypto-werk meer veroorzaken.
  const limited = checkEdgeLimits(ip, pathname);
  if (limited) return limited;

  // Altijd eerst de server-only headers strippen, ook op publieke paden.
  const requestHeaders = new Headers(request.headers);
  for (const header of SERVER_ONLY_HEADERS) requestHeaders.delete(header);

  // Allow public API routes
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Verify auth cookie
  const token = getAuthCookie(request);
  if (!token) {
    return handleUnauthenticated(ip, pathname, "Niet ingelogd");
  }

  const session = await verifyToken(token);
  if (!session) {
    return handleUnauthenticated(ip, pathname, "Sessie verlopen");
  }

  // Pass verified session data to API routes via request headers
  // These headers are trusted because middleware set them (client can't spoof them)
  requestHeaders.set("x-auth-user-id", session.user_id);
  requestHeaders.set("x-auth-tenant", session.tenant);
  requestHeaders.set("x-auth-role", session.role);
  requestHeaders.set("x-auth-name", encodeURIComponent(session.name));

  // Per sessie tellen naast per IP: een gestolen cookie die achter wisselende
  // adressen wordt gebruikt loopt anders langs elke IP-teller heen.
  const sessionKey = `edge:session:${session.user_id}`;
  const sessionResult = consumeMemoryLimit(sessionKey, 900, 60);
  if (!sessionResult.allowed) {
    console.warn(`[rate-limit] sessielimiet geraakt voor gebruiker ${session.user_id}`);
    return limitResponse(sessionResult.retryAfter);
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};
