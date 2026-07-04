import { supabase } from "@/lib/supabase";
import { generateOrRefine } from "@/lib/ai-quote-advisor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  const tenant = request.headers.get("x-auth-tenant");
  if (tenant !== "hiphot") {
    return Response.json({ error: "Alleen beschikbaar voor HipHot" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldige request body" }, { status: 400 });
  }

  const {
    lead_id,
    form_submission_id,   // legacy — wordt vertaald naar lead_id
    history,
    message,
    quote_state,
    selected_note_ids,    // array van note UUIDs
    selected_submission_ids, // array van form_submission UUIDs
  } = body || {};

  // Resolve lead_id (legacy pad: via form_submission_id)
  let resolvedLeadId = lead_id;
  if (!resolvedLeadId && form_submission_id) {
    const { data: fs } = await supabase
      .from("form_submissions")
      .select("lead_id, tenant")
      .eq("id", form_submission_id)
      .maybeSingle();
    if (fs && fs.tenant === tenant) resolvedLeadId = fs.lead_id;
  }

  if (!resolvedLeadId) {
    return Response.json({ error: "lead_id is verplicht" }, { status: 400 });
  }

  // Fetch lead + gebruikersselectie
  const { data: lead } = await supabase
    .from("leads")
    .select("id, tenant, company_name, contact_person, contact_first_name, contact_last_name, industry, city, billing_city, billing_country, delivery_country, email, phone")
    .eq("id", resolvedLeadId)
    .single();

  if (!lead || lead.tenant !== tenant) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  // Haal de geselecteerde notes + submissions op
  const noteIds = Array.isArray(selected_note_ids) ? selected_note_ids : [];
  const subIds = Array.isArray(selected_submission_ids) ? selected_submission_ids : [];

  const [notesRes, submissionsRes] = await Promise.all([
    noteIds.length > 0
      ? supabase
          .from("notes")
          .select("id, created_at, note_type, content, created_by")
          .in("id", noteIds)
          .eq("lead_id", resolvedLeadId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    subIds.length > 0
      ? supabase
          .from("form_submissions")
          .select("id, created_at, source, message, conversation_data, first_name, last_name")
          .in("id", subIds)
          .eq("lead_id", resolvedLeadId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const leadContext = {
    lead: {
      company_name: lead.company_name,
      contact_person: lead.contact_person,
      contact_first_name: lead.contact_first_name,
      contact_last_name: lead.contact_last_name,
      industry: lead.industry,
      city: lead.city || lead.billing_city,
      country: lead.delivery_country || lead.billing_country || "NL",
      phone: lead.phone,
    },
    notes: (notesRes.data || []).map((n) => ({
      id: n.id,
      note_type: n.note_type,
      content: n.content,
      created_at: n.created_at,
      created_by: n.created_by,
    })),
    submissions: (submissionsRes.data || []).map((s) => ({
      id: s.id,
      source: s.source,
      message: s.message,
      conversation_data: s.conversation_data,
      contact: [s.first_name, s.last_name].filter(Boolean).join(" "),
      created_at: s.created_at,
    })),
  };

  const result = await generateOrRefine({
    tenant,
    leadContext,
    history: history || [],
    userMessage: message || null,
    previousQuoteState: quote_state || null,
  });

  if (result.error) {
    return Response.json(
      { error: result.error, raw: result.raw || null },
      { status: 502 }
    );
  }

  // Voetnoot-items: welke items zijn meegenomen (voor AI-rapportage voetnoot in de UI)
  const contextSummary = {
    notes: leadContext.notes.map((n) => ({
      id: n.id,
      note_type: n.note_type,
      created_at: n.created_at,
      preview: String(n.content || "").slice(0, 80),
    })),
    submissions: leadContext.submissions.map((s) => ({
      id: s.id,
      source: s.source,
      created_at: s.created_at,
      preview: String(s.message || "").slice(0, 80),
    })),
    lead: leadContext.lead,
  };

  return Response.json({
    ai_message: result.ai_message,
    quote_state: result.quote_state,
    history: result.history,
    warnings: result.warnings || [],
    quote_unchanged: result.quote_unchanged || false,
    lead_id: resolvedLeadId,
    context_summary: contextSummary,
  });
}
