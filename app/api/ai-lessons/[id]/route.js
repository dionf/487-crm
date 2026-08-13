import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// PATCH /api/ai-lessons/[id] — wijzig lesson (alleen admin)
export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  if (session.role !== "admin") {
    return Response.json({ error: "Alleen admins kunnen regels bewerken" }, { status: 403 });
  }

  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldige body" }, { status: 400 });
  }

  // Alleen toegestane velden accepteren
  const allowed = ["lesson", "context_tags", "priority", "is_active", "promoted_to_base"];
  const update = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: "Geen velden om te wijzigen" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("ai_quote_lessons")
    .update(update)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ lesson: data });
}

// DELETE /api/ai-lessons/[id] — alleen admin
export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  if (session.role !== "admin") {
    return Response.json({ error: "Alleen admins" }, { status: 403 });
  }

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from("ai_quote_lessons")
    .delete()
    .eq("id", id)
    .eq("tenant", tenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true });
}
