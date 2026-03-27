import { supabase } from "@/lib/supabase";

// POST /api/leads/:id/call-outcome — register a call outcome
export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const { outcome, note, user_id, user_name } = body;

  const validOutcomes = [
    "voorstel_mailen",
    "terugbellen_5_dagen",
    "geen_gehoor_terugbellen",
    "niet_geinteresseerd",
    "vraag_opvolgen_collega",
  ];

  if (!validOutcomes.includes(outcome)) {
    return Response.json({ error: "Ongeldige uitkomst" }, { status: 400 });
  }

  const leadId = params.id;

  // Verify lead belongs to tenant
  const { data: lead } = await supabase
    .from("leads").select("tenant").eq("id", leadId).single();
  if (!lead || lead.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Update lead
  const leadUpdate = {
    call_outcome: outcome,
    last_called_at: now,
    last_called_by: user_id || null,
  };

  // Status changes based on outcome
  if (outcome === "niet_geinteresseerd") {
    leadUpdate.status = "offerte_verloren";
  } else if (outcome === "voorstel_mailen") {
    leadUpdate.status = "offerte_gestuurd";
  } else if (outcome === "vraag_opvolgen_collega") {
    leadUpdate.assigned_to = null; // Unassign
  }

  await supabase.from("leads").update(leadUpdate).eq("id", leadId);

  // Add note
  const outcomeLabels = {
    voorstel_mailen: "Voorstel mailen",
    terugbellen_5_dagen: "Terugbellen over 5 dagen",
    geen_gehoor_terugbellen: "Geen gehoor — terugbellen",
    niet_geinteresseerd: "Niet geïnteresseerd",
    vraag_opvolgen_collega: "Interne collega opvolgen",
  };

  let noteContent = `Bel-uitkomst: ${outcomeLabels[outcome]}`;
  if (note) noteContent += `\n\n${note}`;

  await supabase.from("notes").insert({
    lead_id: leadId,
    content: noteContent,
    note_type: "gesprek",
    created_by: user_name || "Agent",
    tenant,
  });

  // Create follow-up tasks
  if (outcome === "terugbellen_5_dagen") {
    await supabase.from("follow_up_tasks").insert({
      lead_id: leadId,
      task_type: "check_in",
      description: "Terugbellen (5 dagen na laatste gesprek)",
      due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      assigned_to: user_id || null,
      tenant,
    });
  } else if (outcome === "geen_gehoor_terugbellen") {
    await supabase.from("follow_up_tasks").insert({
      lead_id: leadId,
      task_type: "check_in",
      description: "Terugbellen (geen gehoor vorige keer)",
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assigned_to: user_id || null,
      tenant,
    });
  }

  // Activity log
  await supabase.from("activities").insert({
    lead_id: leadId,
    activity_type: "call_outcome",
    description: `Bel-uitkomst: ${outcomeLabels[outcome]}`,
    created_by: user_name || "Agent",
    tenant,
  });

  return Response.json({ success: true });
}
