import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function getOrgForTenant(tenant) {
  const { data: org, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .eq("slug", tenant)
    .single();
  if (error || !org) return null;
  return org;
}

async function getActiveAgentsForOrg(orgId, agentIds = []) {
  let query = supabaseAdmin
    .from("users")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("name");

  if (agentIds.length) query = query.in("id", agentIds);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// POST /api/admin/assign — bulk assign leads to agents
export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: "Alleen admins" }, { status: 403 });

  const tenant = session.tenant;
  const org = await getOrgForTenant(tenant);
  if (!org) return Response.json({ error: "Org niet gevonden" }, { status: 404 });

  const body = await request.json();
  const { lead_ids, user_id, mode } = body;

  // Mode: "manual" (assign specific leads) or "auto" (distribute evenly)
  if (mode === "auto") {
    // Get all unassigned leads for this tenant
    const { data: unassigned } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("tenant", tenant)
      .is("assigned_to", null)
      .order("created_at");

    // Use specified agent IDs or all active agents
    let agentList;
    if (body.agent_ids?.length) {
      const requestedAgentIds = [...new Set(body.agent_ids.map((id) => String(id || "").trim()).filter(Boolean))];
      agentList = await getActiveAgentsForOrg(org.id, requestedAgentIds);
      if (agentList.length !== requestedAgentIds.length) {
        return Response.json({ error: "Een of meer agents horen niet bij deze tenant" }, { status: 400 });
      }
    } else {
      agentList = await getActiveAgentsForOrg(org.id);
    }

    if (!agentList?.length || !unassigned?.length) {
      return Response.json({ error: "Geen agents of leads om te verdelen" }, { status: 400 });
    }

    // Round-robin assign
    let assigned = 0;
    for (let i = 0; i < unassigned.length; i++) {
      const agent = agentList[i % agentList.length];
      await supabaseAdmin
        .from("leads")
        .update({ assigned_to: agent.id })
        .eq("tenant", tenant)
        .eq("id", unassigned[i].id);
      assigned++;
    }

    return Response.json({ success: true, assigned, agents: agentList.length });
  }

  // Manual assign
  if (!lead_ids?.length || !user_id) {
    return Response.json({ error: "lead_ids en user_id zijn verplicht" }, { status: 400 });
  }

  const [agent] = await getActiveAgentsForOrg(org.id, [String(user_id).trim()]);
  if (!agent) {
    return Response.json({ error: "Agent hoort niet bij deze tenant" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("leads")
    .update({ assigned_to: user_id })
    .eq("tenant", tenant)
    .in("id", lead_ids)
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ success: true, assigned: data?.length || 0 });
}
