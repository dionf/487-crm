import { getVerifiedSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const PAGE_SIZE = 1000;

export async function GET(request) {
  const session = getVerifiedSession(request);
  if (!session) return Response.json({ error: "Niet ingelogd" }, { status: 401 });
  const tenant = session.tenant;

  // Metrics tellen trajecten, niet bedrijven.
  const opportunities = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .select("id, status, service_type, estimated_value")
      .eq("tenant", tenant)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    opportunities.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  // Build metrics per service_type + status
  const grouped = {};

  for (const opportunity of opportunities) {
    const key = `${opportunity.service_type || "onbekend"}|${opportunity.status}`;
    if (!grouped[key]) {
      grouped[key] = {
        service_type: opportunity.service_type || "onbekend",
        status: opportunity.status,
        lead_count: 0,
        total_value: 0,
        won_count: 0,
        lost_count: 0,
      };
    }
    grouped[key].lead_count++;
    grouped[key].total_value += parseFloat(opportunity.estimated_value) || 0;
    if (opportunity.status === "gewonnen" || opportunity.status === "offerte_gewonnen") grouped[key].won_count++;
    if (opportunity.status === "verloren" || opportunity.status === "offerte_verloren") grouped[key].lost_count++;
  }

  return Response.json({ metrics: Object.values(grouped) });
}
