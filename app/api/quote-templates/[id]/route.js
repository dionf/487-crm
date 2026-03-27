import { supabase } from "@/lib/supabase";

export async function GET(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");

  const { data, error } = await supabase
    .from("quote_templates")
    .select("*")
    .eq("id", params.id)
    .eq("tenant", tenant)
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ template: data });
}

export async function PATCH(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const updates = {};

  for (const key of ["name", "slug", "description", "example_html", "ai_prompt", "default_pricing", "sort_order", "is_active"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("quote_templates")
    .update(updates)
    .eq("id", params.id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ template: data });
}

export async function DELETE(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");

  const { error } = await supabase
    .from("quote_templates")
    .update({ is_active: false })
    .eq("id", params.id)
    .eq("tenant", tenant);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
