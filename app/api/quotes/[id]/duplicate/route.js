import { supabase } from "@/lib/supabase";

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const userName = decodeURIComponent(request.headers.get("x-auth-name") || "");
  const { id } = await params;

  // Bron-quote ophalen + verificatie
  const { data: source } = await supabase
    .from("quotes")
    .select("*, leads(tenant)")
    .eq("id", id)
    .single();

  if (!source || source.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // Nieuwe quote_number via RPC (zelfde nummerreeks als bij aanmaken)
  const { data: newNumber, error: numError } = await supabase.rpc("generate_quote_number");
  if (numError || !newNumber) {
    return Response.json(
      { error: `Kon quote-nummer niet genereren: ${numError?.message || "onbekend"}` },
      { status: 500 }
    );
  }

  // Velden die NIET mee mogen naar de duplicate
  const skip = new Set([
    "id",
    "quote_number",
    "public_hash",
    "status",
    "accepted_at",
    "sent_at",
    "created_at",
    "updated_at",
    "external_order_id",
    "external_order_platform",
    "external_order_url",
    "external_order_created_at",
    "order_customer_reference",
    "leads",
    // Generated columns (DB berekent automatisch — schrijven geeft fout)
    "vat_amount",
    "amount_incl_vat",
    // Quote-specifieke artefacten — opnieuw genereren bij eerste publish/bewerking
    "html_content",
    "pdf_url",
  ]);

  const newQuote = {};
  for (const [k, v] of Object.entries(source)) {
    if (!skip.has(k)) newQuote[k] = v;
  }
  newQuote.quote_number = newNumber;
  newQuote.status = "concept";
  newQuote.valid_until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  newQuote.created_by = userName || null;

  const { data: inserted, error: insertError } = await supabase
    .from("quotes")
    .insert(newQuote)
    .select()
    .single();

  if (insertError || !inserted) {
    return Response.json(
      { error: `Kon offerte niet dupliceren: ${insertError?.message || "onbekend"}` },
      { status: 500 }
    );
  }

  // Line items kopiëren
  const { data: lineItems } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", id)
    .order("sort_order");

  if (lineItems && lineItems.length > 0) {
    const newLines = lineItems.map((item) => {
      const { id: _id, quote_id: _q, created_at: _c, ...rest } = item;
      return { ...rest, quote_id: inserted.id };
    });
    const { error: linesError } = await supabase.from("quote_line_items").insert(newLines);
    if (linesError) {
      await supabase.from("quotes").delete().eq("id", inserted.id);
      return Response.json(
        { error: `Kon regels niet dupliceren: ${linesError.message}` },
        { status: 500 }
      );
    }
  }

  await supabase.from("activities").insert({
    lead_id: source.lead_id,
    activity_type: "quote_duplicated",
    description: `Offerte ${newNumber} aangemaakt als kopie van ${source.quote_number}`,
    metadata: { source_quote_id: source.id, source_quote_number: source.quote_number },
    created_by: userName || null,
    tenant,
  });

  return Response.json({ success: true, quote: inserted });
}
