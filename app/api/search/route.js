import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.length < 2) {
    return Response.json({ results: [] });
  }

  const [leadsRes, notesRes] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, company_name, contact_person, contact_first_name, contact_last_name, status")
      .eq("tenant", tenant)
      .or(`company_name.ilike.%${q}%,contact_person.ilike.%${q}%,contact_first_name.ilike.%${q}%,contact_last_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(5),
    supabaseAdmin
      .from("notes")
      .select("id, content, lead_id, note_type, leads(company_name)")
      .eq("tenant", tenant)
      .ilike("content", `%${q}%`)
      .limit(5),
  ]);

  return Response.json({
    results: {
      leads: leadsRes.data || [],
      notes: notesRes.data || [],
    },
  });
}
