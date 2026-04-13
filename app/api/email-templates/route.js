import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (!tenant) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .select("*")
    .eq("tenant", tenant)
    .order("sort_order", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ templates: data });
}

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  const role = request.headers.get("x-auth-role");
  if (!tenant || role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }

  const body = await request.json();
  const { name, subject, body_html, language, sort_order } = body;

  if (!name || !subject || !body_html) {
    return Response.json({ error: "name, subject en body_html zijn verplicht" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .insert({
      tenant,
      name,
      subject,
      body_html,
      language: language || "nl",
      sort_order: sort_order || 0,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ template: data });
}
