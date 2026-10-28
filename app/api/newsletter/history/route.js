import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  contactNewsletterState,
  fetchNewsletterSuppressions,
  normalizeEmail,
  requireAdmin,
} from "@/lib/newsletters";
import { fetchNewsletterHistory, summarizeHistory } from "@/lib/newsletter-history";

export const dynamic = "force-dynamic";

// Nieuwsbriefhistorie per adres: ?email=...
// Of voor alle adressen van een bedrijf (?lead_id=...), dan ook met de
// nieuwsbriefstatus en een samenvatting per adres.
export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const email = normalizeEmail(searchParams.get("email"));
    const leadId = searchParams.get("lead_id");

    if (email) {
      const history = await fetchNewsletterHistory(tenant, [email]);
      return Response.json({ history: Object.fromEntries(history) });
    }
    if (!leadId) return Response.json({ error: "email of lead_id is verplicht" }, { status: 400 });

    const { data: lead, error } = await supabaseAdmin
      .from("leads")
      .select("id, email, marketing_consent, marketing_subscription_status, marketing_hard_bounced, contacts(email)")
      .eq("tenant", tenant)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return Response.json({ error: "Bedrijf niet gevonden" }, { status: 404 });

    const emails = [...new Set([lead.email, ...(lead.contacts || []).map((contact) => contact.email)].map(normalizeEmail).filter(Boolean))];
    const [history, suppressions] = await Promise.all([
      fetchNewsletterHistory(tenant, emails),
      fetchNewsletterSuppressions(tenant, emails),
    ]);
    const addresses = Object.fromEntries(
      emails.map((address) => [
        address,
        {
          newsletter: contactNewsletterState(lead, address, suppressions.get(address)),
          history: summarizeHistory(history.get(address) || []),
        },
      ])
    );
    return Response.json({ history: Object.fromEntries(history), addresses });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}
