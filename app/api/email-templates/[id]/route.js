import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");
  if (!tenant || role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  // Verify ownership
  const { data: existing } = await supabase
    .from("email_templates")
    .select("id")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (!existing) {
    return Response.json({ error: "Template niet gevonden" }, { status: 404 });
  }

  const updates = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.subject !== undefined) updates.subject = body.subject;
  if (body.body_html !== undefined) updates.body_html = body.body_html;
  if (body.language !== undefined) updates.language = body.language;
  if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

  const { data, error } = await supabase
    .from("email_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ template: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");
  if (!tenant || role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  const { id } = await params;

  const { error } = await supabase
    .from("email_templates")
    .delete()
    .eq("id", id)
    .eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
