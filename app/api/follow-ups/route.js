import { supabase } from "@/lib/supabase";

function getTenant(request) {
  return request.headers.get("x-tenant") || "48-7";
}

export async function GET(request) {
  const tenant = getTenant(request);
  const { data: tasks, error } = await supabase
    .from("follow_up_tasks")
    .select("*, leads(company_name, contact_person, status)")
    .eq("tenant", tenant)
    .eq("is_completed", false)
    .order("due_date", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tasks });
}
