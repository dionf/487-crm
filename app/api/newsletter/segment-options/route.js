import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizeEmail, requireAdmin } from "@/lib/newsletters";

export const dynamic = "force-dynamic";

const CONTACT_BATCH_SIZE = 100;

function countValues(rows, getter) {
  const counts = new Map();
  for (const row of rows || []) {
    const values = getter(row);
    for (const raw of Array.isArray(values) ? values : [values]) {
      const value = String(raw || "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function emailDomain(email) {
  const value = normalizeEmail(email);
  return value ? value.split("@")[1] : "";
}

export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const { data, error } = await supabaseAdmin
      .from("leads")
      .select("id, email, status, relationship_type, hubspot_deal_origin, industry, marketing_segments, marketing_consent, marketing_subscription_status, marketing_hard_bounced")
      .eq("tenant", tenant)
      .eq("marketing_consent", true);
    if (error) throw new Error(error.message);

    const eligible = (data || []).filter((lead) =>
      !lead.marketing_hard_bounced
      && !["unsubscribed", "hard_bounce", "non_marketing"].includes(lead.marketing_subscription_status)
    );

    const leadIds = eligible.map((lead) => lead.id);
    const contactEmails = [];
    for (let i = 0; i < leadIds.length; i += CONTACT_BATCH_SIZE) {
      const ids = leadIds.slice(i, i + CONTACT_BATCH_SIZE);
      if (!ids.length) continue;
      const { data: contacts, error: contactError } = await supabaseAdmin
        .from("contacts")
        .select("email, lead_id")
        .eq("tenant", tenant)
        .in("lead_id", ids);
      if (contactError) throw new Error(contactError.message);
      for (const contact of contacts || []) {
        const domain = emailDomain(contact.email);
        if (domain) contactEmails.push({ domain });
      }
    }
    const leadEmailDomains = eligible
      .map((lead) => ({ domain: emailDomain(lead.email) }))
      .filter((item) => item.domain);

    return Response.json({
      total_marketing: eligible.length,
      options: {
        marketing_segment: countValues(eligible, (lead) => lead.marketing_segments || []),
        lead_status: countValues(eligible, (lead) => lead.status),
        relationship_type: countValues(eligible, (lead) => lead.relationship_type),
        hubspot_deal_origin: countValues(eligible, (lead) => lead.hubspot_deal_origin),
        industry: countValues(eligible, (lead) => lead.industry),
        recipient_email_contains: countValues([...leadEmailDomains, ...contactEmails], (item) => item.domain),
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}
