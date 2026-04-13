import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function scrapeWebsite(url) {
  // Try multiple URL variations
  const urls = [url];
  if (!url.includes("www.")) {
    urls.push(url.replace("https://", "https://www."));
  }

  for (const tryUrl of urls) {
    try {
      const res = await fetch(tryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      if (!html || html.length < 100) continue;

    // Strip scripts, styles, tags — keep text content
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
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
      continue;
    }
  }
  return null;
}

export async function POST(request, { params }) {
  const tenant = request.headers.get("x-auth-tenant");
  const { id } = await params;

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant", tenant)
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

  const isHipHot = tenant === "hiphot";
  const companyDescription = isHipHot
    ? "HipHot, een Nederlands B2B bedrijf dat zonnebrandcrème dispensers, navullingen (Factor 30 / Factor 50) en bijbehorende accessoires levert aan bedrijven, gemeenten, evenementen, scholen, kinderopvang, bouwbedrijven en buitenwerkers — om medewerkers en bezoekers te beschermen tegen UV-straling"
    : "48-7 AI Professionals, een bedrijf dat AI-oplossingen, Cowork (AI werkplekken), trainingen en maatwerk software levert aan bedrijven";

  const kansenLabel = isHipHot ? "Kansen voor HipHot" : "Kansen voor 48-7";
  const kansenVoorbeeld = isHipHot
    ? `- [kans 1: bv. UV-bescherming voor buitenwerkers, evenementen, gasten, kinderen]
- [kans 2: bv. CSR/duurzaamheid, Arbo, employer branding via gezondheid]
- [kans 3: bv. dispenser locaties, jaarcontract navullingen, branding mogelijkheden]`
    : `- [kans 1: concrete kans voor AI automatisering, efficiëntie, data-analyse etc.]
- [kans 2]
- [kans 3]`;

  const prompt = `Je bent een sales intelligence assistent voor ${companyDescription}.

Analyseer het volgende bedrijf en geef een korte samenvatting (max 200 woorden) in het Nederlands. Gebruik deze EXACTE structuur met HTML-achtige koppen:

## Wat doet het bedrijf
[korte omschrijving gebaseerd op de ECHTE website content — GEEN markdown sterretjes gebruiken]

## Sector
[sector/branche]

## Omvang
[inschatting indien mogelijk, anders weglaten]

## ${kansenLabel}
${kansenVoorbeeld}

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

    if (!claudeRes.ok) {
      console.error("Claude API error:", claudeRes.status, JSON.stringify(claudeData));
      return Response.json({
        error: `AI fout: ${claudeData.error?.message || claudeRes.statusText}`,
        summary: `Kon geen samenvatting genereren (${claudeRes.status}: ${claudeData.error?.message || "onbekende fout"}).`,
      });
    }

    const summary = claudeData.content?.[0]?.text || "Kon geen samenvatting genereren.";

    // Save to database
    await supabase
      .from("leads")
      .update({ ai_summary: summary })
      .eq("id", id);

    return Response.json({ summary });
  } catch (err) {
    console.error("AI summary failed:", err);
    return Response.json({ error: "AI samenvatting mislukt: " + err.message }, { status: 500 });
  }
}
