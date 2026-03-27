import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const { data, error } = await supabase
    .from("quote_templates")
    .select("*")
    .eq("tenant", tenant)
    .eq("is_active", true)
    .order("sort_order");

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ templates: data });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();

  const { data, error } = await supabase
    .from("quote_templates")
    .insert({
      name: body.name,
      slug: body.slug || body.name.toLowerCase().replace(/\s+/g, "-"),
      description: body.description || null,
      example_html: body.example_html || null,
      ai_prompt: body.ai_prompt || null,
      default_pricing: body.default_pricing || {},
      sort_order: body.sort_order || 0,
      tenant,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ template: data });
}
