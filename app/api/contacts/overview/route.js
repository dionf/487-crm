import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  fetchSuppressedNewsletterEmails,
  isLeadNewsletterSubscribed,
  normalizeEmail,
  requireAdmin,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;

// Alle contactpersonen van de tenant met hun bedrijf en nieuwsbriefstatus.
// "receives_newsletter" volgt dezelfde regels als buildRecipientsForCampaign
// (zonder segmentfilters): bedrijf ingeschreven en adres niet gesuppressed.
export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);

    const contacts = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("contacts")
        .select(
          "id, lead_id, name, email, phone, role, is_primary, created_at, leads(id, company_name, status, website_url, marketing_consent, marketing_subscription_status, marketing_hard_bounced, newsletter_profile_status)"
        )
        .eq("tenant", tenant)
        .order("name", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      contacts.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const suppressed = await fetchSuppressedNewsletterEmails(
      tenant,
      contacts.map((contact) => contact.email)
    );

    const rows = contacts.map((contact) => {
      const lead = contact.leads || {};
      const email = normalizeEmail(contact.email);
      const companySubscribed = isLeadNewsletterSubscribed(lead);
      const emailSuppressed = Boolean(email) && suppressed.has(email);
      return {
        id: contact.id,
        lead_id: contact.lead_id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        role: contact.role,
        is_primary: contact.is_primary,
        company_name: lead.company_name || "",
        lead_status: lead.status || null,
        website_url: lead.website_url || null,
        marketing_subscription_status: lead.marketing_subscription_status || "unknown",
        company_subscribed: companySubscribed,
        email_suppressed: emailSuppressed,
        receives_newsletter: companySubscribed && Boolean(email) && !emailSuppressed,
        profile_status: lead.newsletter_profile_status || null,
      };
    });

    return Response.json({ contacts: rows });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: err.message }, { status: 500 });
  }
}
