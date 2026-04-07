import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["branch_key", "language", "title", "body", "is_active"];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await supabase
    .from("quote_branch_texts")
    .update(updates)
    .eq("id", id)
    .eq("tenant", "hiphot")
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ text: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await supabase
    .from("quote_branch_texts")
    .delete()
    .eq("id", id)
    .eq("tenant", "hiphot");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
