import { supabase } from "@/lib/supabase";

function getTenant(request) {
  return request.headers.get("x-tenant") || "48-7";
}

export async function GET(request) {
  const tenant = getTenant(request);
  const { searchParams } = new URL(request.url);
  const user = searchParams.get("user");

  let query = supabase
    .from("notes")
    .select("id, content, lead_id, due_date, is_completed, created_by, leads(company_name)")
    .eq("tenant", tenant)
    .eq("note_type", "todo")
    .eq("is_completed", false)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (user) {
    query = query.eq("created_by", user);
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ todos: data || [] });
}
