import { supabase } from "@/lib/supabase";

function getTenant(request) {
  return request.headers.get("x-tenant") || "48-7";
}

// POST /api/admin/assign — bulk assign leads to agents
export async function POST(request) {
  const tenant = getTenant(request);
  const body = await request.json();
  const { lead_ids, user_id, mode } = body;

  // Mode: "manual" (assign specific leads) or "auto" (distribute evenly)
  if (mode === "auto") {
    // Get all unassigned leads for this tenant
    const { data: unassigned } = await supabase
      .from("leads")
      .select("id")
      .eq("tenant", tenant)
      .is("assigned_to", null)
      .order("created_at");

    // Get all active agents
    const { data: org } = await supabase.from("organizations").select("id").eq("slug", tenant).single();
    const { data: agents } = await supabase
      .from("users")
      .select("id")
      .eq("organization_id", org.id)
      .eq("is_active", true)
      .order("name");

    if (!agents?.length || !unassigned?.length) {
      return Response.json({ error: "Geen agents of leads om te verdelen" }, { status: 400 });
    }

    // Round-robin assign
    let assigned = 0;
    for (let i = 0; i < unassigned.length; i++) {
      const agent = agents[i % agents.length];
      await supabase.from("leads").update({ assigned_to: agent.id }).eq("id", unassigned[i].id);
      assigned++;
    }

    return Response.json({ success: true, assigned, agents: agents.length });
  }

  // Manual assign
  if (!lead_ids?.length || !user_id) {
    return Response.json({ error: "lead_ids en user_id zijn verplicht" }, { status: 400 });
  }

  const { error } = await supabase
    .from("leads")
    .update({ assigned_to: user_id })
    .in("id", lead_ids);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, assigned: lead_ids.length });
}
