import { requireAdmin } from "@/lib/newsletters";
import { generateNewsletterJson } from "@/lib/newsletter-ai";
import { SECTION_LABELS, getPersonalizedCampaign } from "@/lib/newsletter-personalize";
import { enforceRateLimit } from "@/lib/rate-limit";
import { scrapeWebsite } from "@/lib/website-scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Korte, concrete titel, max 70 tekens." },
    body: { type: "string", description: "2-4 zinnen, helder en concreet." },
    link_label: { type: "string", description: "Linktekst, bijv. 'Lees de case' of 'Zo werkt het'." },
  },
  required: ["title", "body", "link_label"],
  additionalProperties: false,
};

// AI-concept voor een item op basis van een korte input en/of een URL.
// Wordt niet opgeslagen: de redacteur past aan en slaat zelf op.
export async function POST(request, { params }) {
  try {
    const { tenant, userId } = requireAdmin(request);
    const gate = await enforceRateLimit({
      request,
      policy: "session-expensive",
      identifier: userId,
      scope: "/api/newsletter/items/draft",
      tenant,
    });
    if (gate.response) return gate.response;

    const { id } = await params;
    await getPersonalizedCampaign(tenant, id);
    const body = await request.json();
    const section = SECTION_LABELS[body.section] ? body.section : "company_news";
    const input = String(body.input || "").trim();
    const url = String(body.url || "").trim();
    if (!input && !url) return Response.json({ error: "Geef een korte omschrijving of een link" }, { status: 400 });

    const pageText = /^https?:\/\//i.test(url) ? await scrapeWebsite(url) : null;
    const prompt = `Schrijf een concept voor een item in de nieuwsbrief van 48-7 AI Professionals, sectie "${SECTION_LABELS[section]}". Lezers zijn ondernemers en medewerkers in het mkb.

Toon: jij/jullie-vorm, helder, concreet, geen hype, geen uitroeptekens. Gebruik alleen wat hieronder staat; verzin geen cijfers of feiten.

${input ? `Omschrijving van de redacteur:\n${input}\n` : ""}${url ? `Link: ${url}\n` : ""}${pageText ? `\n--- INHOUD VAN DE LINK ---\n${pageText}\n--- EINDE ---` : ""}`;

    const draft = await generateNewsletterJson(prompt, DRAFT_SCHEMA);
    return Response.json({ draft: { ...draft, section, url: url || null } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: `Concept maken mislukt: ${error.message}` }, { status: 502 });
  }
}
