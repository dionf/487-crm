import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  consumeRateLimit,
  getBlock,
  getClientIp,
  registerFailedAttempt,
} from "@/lib/rate-limit";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

// Hashes komen uit randomBytes(16).toString("hex") — altijd 32 hex-tekens.
const HASH_RE = /^[0-9a-f]{32}$/i;

const SCOPE = "/api/track";

export const dynamic = "force-dynamic";

function pixelResponse() {
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

// GET /api/track/<hash> — trackingpixel in verzonden offerte-mails.
//
// Publiek en zonder auth, dus geschikt om in bulk af te lopen: elke aanroep
// kostte een query op quotes en bij een treffer twee inserts. We geven altijd
// dezelfde pixel terug — een 404 zou verklappen welke hash bestaat — maar
// tellen missers apart, want een mailclient die de pixel laadt heeft per
// definitie een geldige hash. Veel missers = iemand die aan het aflopen is.
export async function GET(request, { params }) {
  const hash = (await params).hash;
  const ip = getClientIp(request);

  const block = await getBlock("public-hash-miss", ip);
  if (block) return pixelResponse();

  // Verkeerd formaat kan geen bestaande hash zijn: meteen afserveren, zonder
  // database-query, en meetellen als misser.
  if (!HASH_RE.test(hash || "")) {
    await registerFailedAttempt({
      request,
      policy: "public-hash-miss",
      identifier: ip,
      scope: SCOPE,
      reason: "Trackingpixel opgevraagd met ongeldig hash-formaat",
    });
    return pixelResponse();
  }

  const volume = await consumeRateLimit("public-hash", ip);
  if (!volume.allowed) return pixelResponse();

  // Look up quote
  const { data: quote } = await supabaseAdmin
    .from("quotes")
    .select("id, tenant")
    .eq("public_hash", hash)
    .maybeSingle();

  if (!quote) {
    await registerFailedAttempt({
      request,
      policy: "public-hash-miss",
      identifier: ip,
      scope: SCOPE,
      reason: "Trackingpixel opgevraagd voor onbekende offerte-hash",
    });
    return pixelResponse();
  }

  // Log the view
  const ua = request.headers.get("user-agent") || "unknown";

  await supabaseAdmin.from("quote_views").insert({
    quote_id: quote.id,
    ip_address: ip,
    user_agent: ua,
  });

  // Log activity for the lead
  const { data: fullQuote } = await supabaseAdmin
    .from("quotes")
    .select("lead_id, quote_number, tenant")
    .eq("id", quote.id)
    .single();

  if (fullQuote?.lead_id) {
    await supabaseAdmin.from("activities").insert({
      lead_id: fullQuote.lead_id,
      activity_type: "quote_viewed",
      description: `Offerte ${fullQuote.quote_number} bekeken`,
      created_by: "Tracking",
      tenant: fullQuote.tenant,
    });
  }

  return pixelResponse();
}
