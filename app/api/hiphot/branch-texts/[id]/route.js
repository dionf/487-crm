import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admin-only functie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["branch_key", "language", "title", "body", "is_active"];
  const updates = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }

  const { data, error } = await supabaseAdmin
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
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }
  if (session.role !== "admin") {
    return Response.json({ error: "Admin-only functie" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await supabaseAdmin
    .from("quote_branch_texts")
    .delete()
    .eq("id", id)
    .eq("tenant", "hiphot");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
