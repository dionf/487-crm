import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data: tasks, error } = await supabase
    .from("follow_up_tasks")
    .select("*, leads(company_name, contact_person, status)")
    .eq("is_completed", false)
    .order("due_date", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ tasks });
}
