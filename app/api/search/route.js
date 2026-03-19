import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.length < 2) {
    return Response.json({ results: [] });
  }

  const [leadsRes, notesRes] = await Promise.all([
    supabase
      .from("leads")
      .select("id, company_name, contact_person, status")
      .or(`company_name.ilike.%${q}%,contact_person.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(5),
    supabase
      .from("notes")
      .select("id, content, lead_id, note_type, leads(company_name)")
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
