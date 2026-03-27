import { supabase } from "@/lib/supabase";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;
  const body = await request.json();

  // Verify note belongs to tenant
  const { data: existing } = await supabase
    .from("notes").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Notitie niet gevonden" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("notes")
    .update(body)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ note: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = params;

  // Verify note belongs to tenant
  const { data: existing } = await supabase
    .from("notes").select("tenant").eq("id", id).single();
  if (!existing || existing.tenant !== tenant) {
    return Response.json({ error: "Notitie niet gevonden" }, { status: 404 });
  }

  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
