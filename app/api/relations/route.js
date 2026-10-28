import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  contactNewsletterState,
  fetchNewsletterSuppressions,
  isLeadNewsletterSubscribed,
  normalizeEmail,
  requireAdmin,
} from "@/lib/newsletters";
import { fetchNewsletterHistory, summarizeHistory } from "@/lib/newsletter-history";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const LEAD_FIELDS = [
  "id",
  "company_name",
  "status",
  "in_pipeline",
  "relationship_type",
  "website_url",
  "email",
  "marketing_consent",
  "marketing_subscription_status",
  "marketing_hard_bounced",
  "newsletter_profile_status",
  "contacts(id, name, email, role, phone, is_primary)",
].join(", ");

// Alle bedrijven met hun contacten, nieuwsbriefstatus per adres en een korte
// historie (aantal ontvangen nieuwsbrieven en de laatste). Het algemene adres
// van het bedrijf (leads.email) ontvangt ook de nieuwsbrief en staat er
// daarom bij als het geen contact is.
export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);

    const leads = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("leads")
        .select(LEAD_FIELDS)
        .eq("tenant", tenant)
        .order("company_name", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      leads.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }

    const companies = leads.map((lead) => {
      const contacts = [...(lead.contacts || [])].sort(
        (a, b) => Number(b.is_primary) - Number(a.is_primary) || String(a.name || "").localeCompare(String(b.name || ""), "nl")
      );
      const contactEmails = new Set(contacts.map((contact) => normalizeEmail(contact.email)).filter(Boolean));
      const companyEmail = normalizeEmail(lead.email);
      const addresses = contacts.map((contact) => ({
        contact_id: contact.id,
        name: contact.name,
        email: contact.email,
        role: contact.role,
        phone: contact.phone,
        is_primary: contact.is_primary,
        is_company_address: false,
      }));
      if (companyEmail && !contactEmails.has(companyEmail)) {
        addresses.push({
          contact_id: null,
          name: "Algemeen adres bedrijf",
          email: lead.email,
          role: null,
          phone: null,
          is_primary: false,
          is_company_address: true,
        });
      }
      return { lead, addresses };
    });

    const allEmails = companies.flatMap(({ addresses }) => addresses.map((address) => address.email));
    const [suppressions, history] = await Promise.all([
      fetchNewsletterSuppressions(tenant, allEmails),
      fetchNewsletterHistory(tenant, allEmails),
    ]);

    const result = companies.map(({ lead, addresses }) => {
      const contacts = addresses.map((address) => {
        const email = normalizeEmail(address.email);
        const summary = summarizeHistory(history.get(email) || []);
        return {
          ...address,
          newsletter: contactNewsletterState(lead, address.email, suppressions.get(email)),
          history: summary,
        };
      });
      return {
        id: lead.id,
        company_name: lead.company_name,
        status: lead.status,
        in_pipeline: lead.in_pipeline !== false,
        relationship_type: lead.relationship_type,
        website_url: lead.website_url,
        newsletter_subscribed: isLeadNewsletterSubscribed(lead),
        marketing_subscription_status: lead.marketing_subscription_status || "unknown",
        profile_status: lead.newsletter_profile_status || null,
        receiving_count: contacts.filter((contact) => contact.newsletter.receives).length,
        newsletter_count: Math.max(0, ...contacts.map((contact) => contact.history.count)),
        contacts,
      };
    });

    return Response.json({ companies: result });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}
