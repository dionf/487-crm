import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLeadStatuses } from "@/lib/constants";

const EDITABLE_FIELDS = ["name", "status", "service_type", "estimated_value", "win_reason", "lost_reason"];

// Wijzig een traject (status, naam, waarde). won_at/lost_at zet de database;
// de lead volgt via de trigger uit migrations/037_opportunities.sql.
export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;
  const body = await request.json();

  const patch = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) patch[field] = body[field] === "" ? null : body[field];
  }
  if ("name" in patch) {
    patch.name = String(patch.name || "").trim();
    if (!patch.name) return Response.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if ("status" in patch && !getLeadStatuses(tenant).some((s) => s.id === patch.status)) {
    return Response.json({ error: "Onbekende status" }, { status: 400 });
  }
  if ("estimated_value" in patch && patch.estimated_value !== null) {
    const value = Number(patch.estimated_value);
    patch.estimated_value = Number.isFinite(value) ? value : null;
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Geen velden om te wijzigen" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("opportunities")
    .update(patch)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Traject niet gevonden" }, { status: 404 });

  return Response.json({ opportunity: data });
}

// Verwijderen kan alleen zonder offertes en zolang de lead nog een ander traject heeft.
export async function DELETE(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  const { data: opportunity } = await supabaseAdmin
    .from("opportunities")
    .select("id, lead_id, name, quotes(id)")
    .eq("id", id)
    .eq("tenant", tenant)
    .maybeSingle();
  if (!opportunity) return Response.json({ error: "Traject niet gevonden" }, { status: 404 });

  if (opportunity.quotes?.length) {
    return Response.json({ error: "Dit traject heeft offertes; verplaats of verwijder die eerst" }, { status: 409 });
  }
  const { count } = await supabaseAdmin
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", opportunity.lead_id)
    .eq("tenant", tenant);
  if ((count || 0) <= 1) {
    return Response.json({ error: "Een bedrijf houdt minstens één traject" }, { status: 409 });
  }

  const { error } = await supabaseAdmin.from("opportunities").delete().eq("id", id).eq("tenant", tenant);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from("activities").insert({
    lead_id: opportunity.lead_id,
    activity_type: "opportunity_deleted",
    description: `Traject verwijderd: ${opportunity.name}`,
    created_by: session.name || null,
    tenant,
  });

  return Response.json({ success: true });
}
