import Anthropic from "@anthropic-ai/sdk";
import { NEWSLETTER_MODEL } from "@/lib/ai-models";
import { requireAdmin } from "@/lib/newsletters";
import { SECTION_LABELS, getPersonalizedCampaign } from "@/lib/newsletter-personalize";
import { enforceRateLimit } from "@/lib/rate-limit";
import { scrapeWebsite } from "@/lib/website-scrape";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRAFT_TOOL = {
  name: "schrijf_item",
  description: "Lever een concept voor één nieuwsbriefitem.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Korte, concrete titel, max 70 tekens." },
      body: { type: "string", description: "2-4 zinnen, helder en concreet." },
      link_label: { type: "string", description: "Linktekst, bijv. 'Lees de case' of 'Zo werkt het'." },
    },
    required: ["title", "body", "link_label"],
  },
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
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("API key niet geconfigureerd");

    const body = await request.json();
    const section = SECTION_LABELS[body.section] ? body.section : "company_news";
    const input = String(body.input || "").trim();
    const url = String(body.url || "").trim();
    if (!input && !url) return Response.json({ error: "Geef een korte omschrijving of een link" }, { status: 400 });

    const pageText = /^https?:\/\//i.test(url) ? await scrapeWebsite(url) : null;
    const prompt = `Schrijf een concept voor een item in de nieuwsbrief van 48-7 AI Professionals, sectie "${SECTION_LABELS[section]}". Lezers zijn ondernemers en medewerkers in het mkb.

Toon: jij/jullie-vorm, helder, concreet, geen hype, geen uitroeptekens. Gebruik alleen wat hieronder staat; verzin geen cijfers of feiten.

${input ? `Omschrijving van de redacteur:\n${input}\n` : ""}${url ? `Link: ${url}\n` : ""}${pageText ? `\n--- INHOUD VAN DE LINK ---\n${pageText}\n--- EINDE ---` : ""}`;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: NEWSLETTER_MODEL,
      max_tokens: 800,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: DRAFT_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });
    const draft = resp.content?.find((block) => block.type === "tool_use")?.input;
    if (!draft) throw new Error("Claude gaf geen bruikbaar antwoord terug");
    return Response.json({ draft: { ...draft, section, url: url || null } });
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: `Concept maken mislukt: ${error.message}` }, { status: 502 });
  }
}
