import { supabase } from "@/lib/supabase";

// POST /api/leads/:id/call-outcome — register a call outcome
export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const body = await request.json();
  const { outcome, note, user_id, user_name, follow_up_user_id, follow_up_user_name } = body;

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

  // "Interne collega opvolgen" heeft verplicht een user_id nodig, anders gaat de taak verloren
  if (outcome === "vraag_opvolgen_collega" && !follow_up_user_id) {
    return Response.json({ error: "Kies een collega om de lead aan over te dragen" }, { status: 400 });
  }

  const leadId = (await params).id;

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

  // Status changes based on outcome (HipHot only — 48-7 keeps own pipeline)
  if (outcome === "niet_geinteresseerd") {
    leadUpdate.status = tenant === "hiphot" ? "offerte_verloren" : "verloren";
  } else if (outcome === "voorstel_mailen") {
    leadUpdate.status = tenant === "hiphot" ? "offerte_gestuurd" : "offerte_verstuurd";
  } else if (outcome === "terugbellen_5_dagen" || outcome === "geen_gehoor_terugbellen") {
    if (tenant === "hiphot") leadUpdate.status = "terugbellen";
  } else if (outcome === "vraag_opvolgen_collega") {
    leadUpdate.assigned_to = follow_up_user_id || null;
  }

  await supabase.from("leads").update(leadUpdate).eq("id", leadId);

  // Add note
  const outcomeLabels = {
    voorstel_mailen: "Voorstel mailen",
    terugbellen_5_dagen: "Terugbellen",
    geen_gehoor_terugbellen: "Geen gehoor — terugbellen",
    niet_geinteresseerd: "Niet geïnteresseerd",
    vraag_opvolgen_collega: "Interne collega opvolgen",
  };

  let noteContent = `Bel-uitkomst: ${outcomeLabels[outcome]}`;
  if (outcome === "vraag_opvolgen_collega" && follow_up_user_name) {
    noteContent += ` → ${follow_up_user_name}`;
  }
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
      description: "Terugbellen",
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
  } else if (outcome === "vraag_opvolgen_collega" && follow_up_user_id) {
    const { error: taskErr } = await supabase.from("follow_up_tasks").insert({
      lead_id: leadId,
      task_type: "internal_followup",
      description: `Lead opvolgen — doorgegeven door ${user_name || "collega"}`,
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assigned_to: follow_up_user_id,
      tenant,
    });
    if (taskErr) {
      console.error("[call-outcome] follow_up_task insert failed:", taskErr.message);
      return Response.json(
        { error: `Lead bijgewerkt maar opvolgtaak voor collega niet aangemaakt: ${taskErr.message}` },
        { status: 500 }
      );
    }
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
