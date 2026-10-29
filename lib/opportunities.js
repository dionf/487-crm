import { supabaseAdmin } from "@/lib/supabase-admin";

// Trajecten (opportunities): één lead kan er meerdere hebben. leads.status en
// leads.estimated_value spiegelen het "huidige traject" via DB-triggers
// (migrations/037_opportunities.sql), dus schrijf status en waarde hier.

export const WON_STATUSES = ["gewonnen", "offerte_gewonnen"];
export const LOST_STATUSES = ["verloren", "offerte_verloren"];

export function wonStatusFor(tenant) {
  return tenant === "hiphot" ? "offerte_gewonnen" : "gewonnen";
}

// Kies het traject voor een offerte: het gevraagde (als het bij de lead hoort),
// anders het huidige traject van de lead.
export async function resolveOpportunityId(leadId, tenant, requestedId) {
  if (requestedId) {
    const { data } = await supabaseAdmin
      .from("opportunities")
      .select("id")
      .eq("id", requestedId)
      .eq("lead_id", leadId)
      .eq("tenant", tenant)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data } = await supabaseAdmin.rpc("current_opportunity_id", { p_lead_id: leadId });
  return data || null;
}

// Waarde van een traject = som van zijn niet-afgewezen offertes.
// Offertes zonder traject (oud) vallen terug op de lead.
export async function updateOpportunityValue({ opportunityId, leadId, tenant }) {
  let query = supabaseAdmin
    .from("quotes")
    .select("amount_excl_vat")
    .eq("tenant", tenant)
    .not("status", "eq", "afgewezen");
  query = opportunityId ? query.eq("opportunity_id", opportunityId) : query.eq("lead_id", leadId);

  const { data: quotes } = await query;
  const totalValue = (quotes || []).reduce((sum, q) => sum + (Number(q.amount_excl_vat) || 0), 0);

  if (opportunityId) {
    await supabaseAdmin
      .from("opportunities")
      .update({ estimated_value: totalValue })
      .eq("id", opportunityId)
      .eq("tenant", tenant);
  } else if (leadId) {
    await supabaseAdmin
      .from("leads")
      .update({ estimated_value: totalValue })
      .eq("id", leadId)
      .eq("tenant", tenant);
  }
}
