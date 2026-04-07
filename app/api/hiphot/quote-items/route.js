import { supabase } from "@/lib/supabase";

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { items } = await request.json();
  if (!items || items.length === 0) {
    return Response.json({ error: "Geen items opgegeven" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("quote_line_items")
    .insert(items)
    .select();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data }, { status: 201 });
}

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const quote_id = searchParams.get("quote_id");

  if (!quote_id) {
    return Response.json({ error: "quote_id is verplicht" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("quote_line_items")
    .select("*")
    .eq("quote_id", quote_id)
    .order("sort_order");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ items: data });
}
