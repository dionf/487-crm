import { supabase } from "@/lib/supabase";

async function scrapeWebsite(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; 487CRM/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Strip scripts, styles, tags — keep text content
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Limit to ~3000 chars to stay within token budget
    if (text.length > 3000) {
      text = text.substring(0, 3000) + "...";
    }

    return text;
  } catch {
    return null;
  }
}

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

  // Scrape website if URL is available
  let websiteContent = null;
  if (lead.website_url) {
    let url = lead.website_url;
    if (!url.startsWith("http")) url = "https://" + url;
    websiteContent = await scrapeWebsite(url);
  }

  // Also fetch notes for extra context
  const { data: notes } = await supabase
    .from("notes")
    .select("content, note_type")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  const notesContext = notes?.length
    ? notes.map((n) => `[${n.note_type}] ${n.content}`).join("\n")
    : "";

  const prompt = `Je bent een sales intelligence assistent voor 48-7 AI Professionals, een bedrijf dat AI-oplossingen, Cowork (AI werkplekken), trainingen en maatwerk software levert aan bedrijven.

Analyseer het volgende bedrijf en geef een korte samenvatting (max 200 woorden) in het Nederlands. Gebruik deze EXACTE structuur met HTML-achtige koppen:

## Wat doet het bedrijf
[korte omschrijving gebaseerd op de ECHTE website content — GEEN markdown sterretjes gebruiken]

## Sector
[sector/branche]

## Omvang
[inschatting indien mogelijk, anders weglaten]

## Kansen voor 48-7
- [kans 1: concrete kans voor AI automatisering, efficiëntie, data-analyse etc.]
- [kans 2]
- [kans 3]

## Gesprekstip
[concrete suggestie voor eerste contact]

REGELS:
- Gebruik GEEN markdown sterretjes (**) voor vetgedrukt. Gebruik ## voor koppen en - voor bulletpoints.
- Baseer je analyse ALLEEN op de meegeleverde website content en notities. Verzin NIETS. Als je iets niet weet, zeg dat dan.
- Als er CRM notities zijn met gespreksinfo, gebruik die voor context bij kansen en gesprekstip.

Bedrijf: ${lead.company_name}
${lead.website_url ? `Website: ${lead.website_url}` : ""}
${lead.service_type ? `Interesse: ${lead.service_type}` : ""}
Contactpersoon: ${lead.contact_person}
${lead.email ? `Email: ${lead.email}` : ""}

${websiteContent ? `--- WEBSITE CONTENT ---\n${websiteContent}\n--- EINDE WEBSITE ---` : "Geen website content beschikbaar."}

${notesContext ? `--- CRM NOTITIES ---\n${notesContext}\n--- EINDE NOTITIES ---` : ""}`;

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
        max_tokens: 600,
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
