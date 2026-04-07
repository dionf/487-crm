import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  // Only allow updating specific fields
  const allowed = [
    "name", "description", "category", "inkoop_price", "verkoop_price",
    "sale_price", "is_active", "sort_order", "sku",
  ];
  const updates = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Geen velden om te updaten" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("hiphot_articles")
    .update(updates)
    .eq("id", id)
    .eq("tenant", "hiphot")
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ article: data });
}
