import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request, { params }) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;
  const userName = session.name || "";
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const days = Number(body.days) > 0 ? Number(body.days) : 30;

  const { data: quote } = await supabaseAdmin
    .from("quotes")
    .select("id, quote_number, lead_id, status, accepted_at, leads(tenant)")
    .eq("id", id)
    .single();

  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  if (quote.accepted_at) {
    return Response.json(
      { error: "Deze offerte is al geaccepteerd en kan niet worden verlengd" },
      { status: 400 }
    );
  }

  const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Verlopen → terug naar 'verstuurd' (concept blijft concept)
  const newStatus =
    quote.status === "verlopen" || quote.status === "afgewezen"
      ? "verstuurd"
      : quote.status;

  const { data: updated, error } = await supabaseAdmin
    .from("quotes")
    .update({ valid_until: validUntil, status: newStatus })
    .eq("id", id)
    .eq("tenant", tenant)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from("activities").insert({
    lead_id: quote.lead_id,
    activity_type: "quote_extended",
    description: `Offerte ${quote.quote_number} verlengd tot ${validUntil} (${days} dagen)`,
    created_by: userName || null,
    tenant,
  });

  return Response.json({ success: true, quote: updated });
}
