import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admin-only functie" }, { status: 403 });
  }

  const { items, replace_for_quote_id } = await request.json();
  if (!items || items.length === 0) {
    return Response.json({ error: "Geen items opgegeven" }, { status: 400 });
  }

  const quoteIds = [
    ...new Set(
      items.map((item) => String(item.quote_id || "").trim()).filter(Boolean)
    ),
  ];
  if (replace_for_quote_id && quoteIds.some((quoteId) => quoteId !== replace_for_quote_id)) {
    return Response.json({ error: "Offertregels horen niet bij dezelfde offerte" }, { status: 400 });
  }
  const expectedQuoteIds = replace_for_quote_id
    ? [...new Set([...quoteIds, replace_for_quote_id])]
    : quoteIds;
  if (expectedQuoteIds.length === 0) {
    return Response.json({ error: "quote_id is verplicht" }, { status: 400 });
  }

  const { data: allowedQuotes, error: quoteError } = await supabaseAdmin
    .from("quotes")
    .select("id, leads(tenant)")
    .in("id", expectedQuoteIds);

  if (quoteError) {
    return Response.json({ error: quoteError.message }, { status: 500 });
  }

  const allowedQuoteIds = new Set(
    (allowedQuotes || [])
      .filter((quote) => quote.leads?.tenant === "hiphot")
      .map((quote) => quote.id)
  );
  if (allowedQuoteIds.size !== expectedQuoteIds.length) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // When editing a quote: delete existing line items first
  if (replace_for_quote_id) {
    await supabaseAdmin.from("quote_line_items").delete().eq("quote_id", replace_for_quote_id);
  }

  const itemsToInsert = items.map((item) => ({
    ...item,
    quote_id: replace_for_quote_id || item.quote_id,
  }));

  const { data, error } = await supabaseAdmin
    .from("quote_line_items")
    .insert(itemsToInsert)
    .select();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data }, { status: 201 });
}

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const quote_id = searchParams.get("quote_id");

  if (!quote_id) {
    return Response.json({ error: "quote_id is verplicht" }, { status: 400 });
  }

  const { data: quote } = await supabaseAdmin
    .from("quotes")
    .select("id, leads(tenant)")
    .eq("id", quote_id)
    .single();

  if (!quote || quote.leads?.tenant !== "hiphot") {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", quote_id)
    .order("sort_order");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data });
}
