import {
  declineNewsletter,
  fetchPendingNewsletterCompanies,
  requireAdmin,
  subscribeCompanyAddresses,
} from "@/lib/newsletters";

export const dynamic = "force-dynamic";

// Bedrijven en adressen zonder nieuwsbriefvinkje (Nieuwsbrieven › Nog geen
// nieuwsbrief).
export async function GET(request) {
  try {
    const { tenant } = requireAdmin(request);
    const companies = await fetchPendingNewsletterCompanies(tenant);
    return Response.json({
      companies,
      company_count: companies.filter((company) => company.company_pending).length,
      address_count: companies.reduce((sum, company) => sum + company.addresses.length, 0),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// { lead_id, action: "subscribe", emails: [...] } schrijft precies die adressen
// in (en het bedrijf, als dat nog uit stond).
// { lead_id, action: "decline", emails: [...] } kiest bewust voor geen
// nieuwsbrief: het bedrijf (als het nog niet besloten was) en de adressen.
export async function POST(request) {
  try {
    const session = requireAdmin(request);
    const body = await request.json();
    const emails = Array.isArray(body.emails) ? body.emails : [];
    if (!body.lead_id) return Response.json({ error: "lead_id is verplicht" }, { status: 400 });

    if (body.action === "subscribe") {
      if (!emails.length) return Response.json({ error: "Kies minstens één adres" }, { status: 400 });
      const result = await subscribeCompanyAddresses({
        tenant: session.tenant,
        leadId: body.lead_id,
        emails,
        reason: "handmatig (Nieuwsbrieven › Nog geen nieuwsbrief)",
        userName: session.userName,
      });
      return Response.json({ success: true, ...result });
    }
    if (body.action === "decline") {
      await declineNewsletter({
        tenant: session.tenant,
        leadId: body.company_pending ? body.lead_id : null,
        emails: body.company_pending ? [] : emails,
        userName: session.userName,
      });
      return Response.json({ success: true });
    }
    return Response.json({ error: "Onbekende actie" }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: error.message }, { status: 400 });
  }
}
