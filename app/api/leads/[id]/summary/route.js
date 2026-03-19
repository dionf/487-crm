import { supabase } from "@/lib/supabase";

export async function POST(request, { params }) {
  const { id } = params;

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !lead) {
    return Response.json({ error: "Lead niet gevonden" }, { status: 404 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "API key niet geconfigureerd" }, { status: 500 });
  }

  const prompt = `Je bent een sales intelligence assistent voor 48-7 AI Professionals, een bedrijf dat AI-oplossingen, Cowork (AI werkplekken), trainingen en maatwerk software levert aan bedrijven.

Analyseer het volgende bedrijf en geef een korte samenvatting (max 150 woorden) in het Nederlands:
- Wat doet het bedrijf
- In welke sector zitten ze
- Waar liggen de kansen voor 48-7 (AI automatisering, efficiëntie, data-analyse, etc.)
- Concrete suggesties voor eerste gesprek

Bedrijf: ${lead.company_name}
${lead.website_url ? `Website: ${lead.website_url}` : ""}
${lead.service_type ? `Interesse: ${lead.service_type}` : ""}
Contactpersoon: ${lead.contact_person}`;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const summary = claudeData.content?.[0]?.text || "Kon geen samenvatting genereren.";

    // Save to database
    await supabase
      .from("leads")
      .update({ ai_summary: summary })
      .eq("id", id);

    return Response.json({ summary });
  } catch (err) {
    return Response.json({ error: "AI samenvatting mislukt" }, { status: 500 });
  }
}
