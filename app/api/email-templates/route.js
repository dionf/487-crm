import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) {
    return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const tenant = session.tenant;

  const { data, error } = await supabaseAdmin
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
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") {
    return Response.json({ error: "Geen toegang" }, { status: 403 });
  }
  const tenant = session.tenant;

  const body = await request.json();
  const { name, subject, body_html, language, sort_order } = body;

  if (!name || !subject || !body_html) {
    return Response.json({ error: "name, subject en body_html zijn verplicht" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
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
