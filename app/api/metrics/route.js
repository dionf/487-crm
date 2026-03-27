import { supabase } from "@/lib/supabase";

export async function GET(request) {
  const tenant = request.headers.get("x-auth-tenant");

  const { data: leads, error } = await supabase
    .from("leads")
    .select("status, service_type, estimated_value, created_at, won_at, updated_at")
    .eq("tenant", tenant);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Build metrics per service_type + status
  const grouped = {};

  for (const lead of leads || []) {
    const key = `${lead.service_type || "onbekend"}|${lead.status}`;
    if (!grouped[key]) {
      grouped[key] = {
        service_type: lead.service_type || "onbekend",
        status: lead.status,
        lead_count: 0,
        total_value: 0,
        won_count: 0,
        lost_count: 0,
      };
    }
    grouped[key].lead_count++;
    grouped[key].total_value += parseFloat(lead.estimated_value) || 0;
    if (lead.status === "gewonnen" || lead.status === "offerte_gewonnen") grouped[key].won_count++;
    if (lead.status === "verloren" || lead.status === "offerte_verloren") grouped[key].lost_count++;
  }

  return Response.json({ metrics: Object.values(grouped) });
}
