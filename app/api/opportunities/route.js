import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLeadStatuses } from "@/lib/constants";

const PAGE_SIZE = 1000;

// Lead-velden die de kanbankaart en de HipHot-belfilters nodig hebben.
const SELECT = [
  "*",
  "quotes(id)",
  "leads!inner(id, company_name, contact_person, contact_first_name, contact_last_name, phone, source, website_url, in_pipeline, relationship_type, call_outcome, last_called_at, marketing_consent, notes(id, is_completed, note_type))",
].join(", ");

function cleanValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Trajecten van de tenant. scope=pipeline (standaard) alleen bedrijven in de
// salespipeline, scope=all ook relaties (gewonnen klanten tellen mee in omzet).
export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "pipeline";
  const status = searchParams.get("status");
  const leadId = searchParams.get("lead_id");
  const callFilter = searchParams.get("call_filter");

  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabaseAdmin
      .from("opportunities")
      .select(SELECT)
      .eq("tenant", tenant)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (scope === "pipeline") query = query.eq("leads.in_pipeline", true);
    if (scope === "relations") query = query.eq("leads.in_pipeline", false);
    if (status) query = query.eq("status", status);
    if (leadId) query = query.eq("lead_id", leadId);

    // HipHot bellijst filters
    if (callFilter === "nieuw") {
      query = query.is("leads.call_outcome", null).is("leads.last_called_at", null);
    } else if (callFilter === "terugbellen") {
      query = query.eq("leads.call_outcome", "terugbellen_5_dagen");
    } else if (callFilter === "geen_gehoor") {
      query = query.eq("leads.call_outcome", "geen_gehoor_terugbellen");
    }

    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const opportunities = rows.map(({ leads: lead, quotes, ...opportunity }) => {
    const notes = lead?.notes || [];
    return {
      ...opportunity,
      lead: { ...lead, notes: undefined },
      quote_count: quotes?.length || 0,
      note_count: notes.length,
      open_todo_count: notes.filter((n) => n.note_type === "todo" && !n.is_completed).length,
    };
  });

  return Response.json({ opportunities, total: opportunities.length });
}

// Nieuw traject op een bestaand bedrijf.
export async function POST(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const body = await request.json();

  const name = String(body.name || "").trim();
  if (!body.lead_id || !name) {
    return Response.json({ error: "Bedrijf en naam van het traject zijn verplicht" }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, tenant")
    .eq("id", body.lead_id)
    .eq("tenant", tenant)
    .maybeSingle();
  if (!lead) return Response.json({ error: "Lead niet gevonden" }, { status: 404 });

  const statuses = getLeadStatuses(tenant);
  const defaultStatus = tenant === "hiphot" ? "nieuwe_aanvraag" : "nieuw";
  const status = statuses.some((s) => s.id === body.status) ? body.status : defaultStatus;

  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .insert({
      tenant,
      lead_id: lead.id,
      name,
      status,
      service_type: body.service_type || null,
      estimated_value: cleanValue(body.estimated_value),
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from("activities").insert({
    lead_id: lead.id,
    activity_type: "opportunity_created",
    description: `Nieuw traject: ${name}`,
    metadata: { opportunity_id: data.id },
    created_by: session.name || null,
    tenant,
  });

  return Response.json({ opportunity: data }, { status: 201 });
}
