import { supabase } from "@/lib/supabase";

function getTenant(request) {
  return request.headers.get("x-tenant") || "48-7";
}

export async function GET(request) {
  const tenant = getTenant(request);
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.length < 2) {
    return Response.json({ results: [] });
  }

  const [leadsRes, notesRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, company_name, contact_person, status")
      .eq("tenant", tenant)
      .or(`company_name.ilike.%${q}%,contact_person.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(5),
    supabase
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
