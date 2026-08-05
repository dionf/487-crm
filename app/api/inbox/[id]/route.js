import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("form_submissions")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
    .single();

  if (error || !data) {
    return Response.json({ error: "Niet gevonden" }, { status: 404 });
  }

  return Response.json({ submission: data });
}

export async function PATCH(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const { id } = await params;
  const body = await request.json();

  // Prevent status downgrade: gelezen can't overwrite beantwoord/gearchiveerd
  if (body.status === "gelezen") {
    const { data: current } = await supabaseAdmin
      .from("form_submissions")
      .select("status")
      .eq("id", id)
      .eq("tenant", tenant)
      .single();

    if (current && ["beantwoord", "gearchiveerd"].includes(current.status)) {
      return Response.json({ submission: current });
    }
  }

  const updates = {};
  if (body.status) {
    const allowedStatuses = new Set(["nieuw", "gelezen", "beantwoord", "gearchiveerd"]);
    if (!allowedStatuses.has(body.status)) {
      return Response.json({ error: "Ongeldige status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (body.lead_id) {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, tenant")
      .eq("id", body.lead_id)
      .single();
    if (!lead || lead.tenant !== tenant) {
      return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
    }
    updates.lead_id = body.lead_id;
  }

  const { data, error } = await supabaseAdmin
    .from("form_submissions")
    .update(updates)
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ submission: data });
}
