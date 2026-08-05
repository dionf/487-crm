import { supabaseAdmin } from "@/lib/supabase-admin";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(request, { params }) {
  const hash = (await params).hash;

  // Look up quote
  const { data: quote } = await supabaseAdmin
    .from("quotes")
    .select("id, tenant")
    .eq("public_hash", hash)
    .maybeSingle();

  if (quote) {
    // Log the view
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
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
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
