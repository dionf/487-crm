import { supabase } from "@/lib/supabase";

export async function POST(request, { params }) {
  const hash = params.hash;

  // Find quote by hash
  const { data: quote, error: findError } = await supabase
    .from("quotes")
    .select("id, lead_id, quote_number, status, valid_until, accepted_at")
    .eq("public_hash", hash)
    .maybeSingle();

  if (!quote) {
    return Response.json(
      { error: "Offerte niet gevonden" },
      { status: 404 }
    );
  }

  // Check if already accepted
  if (quote.accepted_at) {
    return Response.json(
      { error: "Deze offerte is al geaccepteerd", accepted_at: quote.accepted_at },
      { status: 400 }
    );
  }

  // Check validity
  if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
    return Response.json(
      { error: "Deze offerte is verlopen" },
      { status: 410 }
    );
  }

  // Check status
  if (quote.status === "afgewezen") {
    return Response.json(
      { error: "Deze offerte is afgewezen" },
      { status: 400 }
    );
  }

  // Accept the quote
  const { error: updateError } = await supabase
    .from("quotes")
    .update({
      accepted_at: new Date().toISOString(),
      status: "geaccepteerd",
    })
    .eq("id", quote.id);

  if (updateError) {
    return Response.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  // Log activity
  if (quote.lead_id) {
    await supabase.from("activities").insert({
      lead_id: quote.lead_id,
      activity_type: "quote_accepted",
      description: `Offerte ${quote.quote_number} geaccepteerd door klant via publieke link`,
      created_by: "Klant",
    });
  }

  return Response.json({
    success: true,
    message: "Offerte geaccepteerd",
    quote_number: quote.quote_number,
  });
}
