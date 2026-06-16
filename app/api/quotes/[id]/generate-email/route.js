import { supabase } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tenant = request.headers.get("x-auth-tenant");
  const userId = request.headers.get("x-auth-user-id");
  const { id } = await params;

  // Fetch sender info for signature
  let sender = null;
  if (userId) {
    const { data } = await supabase
      .from("users")
      .select("name, email, phone")
      .eq("id", userId)
      .single();
    sender = data;
  }

  // Verify quote
  const { data: quote } = await supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person, contact_first_name, contact_last_name, contact_function, email, industry, language, tenant)")
    .eq("id", id)
    .single();

  if (!quote || quote.leads?.tenant !== tenant) {
    return Response.json({ error: "Offerte niet gevonden" }, { status: 404 });
  }

  // Get line items for context
  const { data: lineItems } = await supabase
    .from("quote_line_items")
    .select("name, quantity, unit_price, line_total")
    .eq("quote_id", id)
    .order("sort_order");

  const lead = quote.leads;
  const lang = quote.language || lead?.language || "nl";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.48-7.nl";
  const quoteUrl = quote.public_hash ? `${baseUrl}/offerte/${quote.public_hash}` : null;

  // Get notes for context
  const { data: notes } = await supabase
    .from("notes")
    .select("content, note_type")
    .eq("lead_id", quote.lead_id)
    .in("note_type", ["gesprek", "intern"])
    .order("created_at", { ascending: false })
    .limit(5);

  const langMap = { nl: "Nederlands", en: "English", de: "Deutsch", fr: "Français" };

  const itemsSummary = (lineItems || [])
    .map((i) => `- ${i.quantity}x ${i.name} (€${Number(i.line_total).toFixed(2)})`)
    .join("\n");

  const notesSummary = (notes || [])
    .map((n) => `- [${n.note_type}] ${n.content?.substring(0, 150)}`)
    .join("\n");

  const companyName = tenant === "hiphot" ? "HipHot B.V." : "48-7 AI Professionals";
  const companyShort = tenant === "hiphot" ? "HipHot" : "48-7 AI Professionals";
  const companyClosing = tenant === "hiphot" ? "Met zonnige groet," : "Met vriendelijke groet,";
  const companyPhone = tenant === "hiphot" ? "+31 (0)85-505 56 64" : "+31 (0)85-06 01 487";
  const senderName = sender?.name?.trim();
  const senderPhone = sender?.phone?.trim();
  const senderEmail = sender?.email?.trim();

  // Vaste handtekening — nooit door Claude zelf samenstellen, anders mist 't vaak.
  // Structuur: groet + witregel + naam + bedrijf + telefoon + email
  const signatureLines = [];
  if (senderName) signatureLines.push(`<strong>${senderName}</strong>`);
  signatureLines.push(companyShort);
  if (senderPhone) signatureLines.push(senderPhone);
  else signatureLines.push(companyPhone);
  if (senderEmail) signatureLines.push(senderEmail);
  const signatureHtml =
    `<p>${companyClosing}</p>` +
    `<p><br></p>` +
    `<p>${signatureLines.join("<br>")}</p>`;

  const prompt = `Je schrijft een professionele, persoonlijke e-mail namens ${companyName} om een offerte te versturen.

Klantgegevens:
- Bedrijf: ${lead?.company_name || "Onbekend"}
- Voornaam: ${lead?.contact_first_name || lead?.contact_person?.split(" ")[0] || ""}
- Achternaam: ${lead?.contact_last_name || ""}
- Functie: ${lead?.contact_function || "onbekend"}
- Branche: ${lead?.industry || "onbekend"}
- Taal: ${langMap[lang] || "Nederlands"}

Offerte details:
- Offertenummer: ${quote.quote_number}
- Totaalbedrag excl. BTW: €${Number(quote.amount_excl_vat).toFixed(2)}
${itemsSummary ? `\nProducten:\n${itemsSummary}` : ""}
${quoteUrl ? `\nOfferte link: ${quoteUrl}` : ""}

${notesSummary ? `Recente notities over deze klant:\n${notesSummary}\n` : ""}

Instructies:
- Schrijf in ${langMap[lang] || "Nederlands"}
- Toon: professioneel maar warm en persoonlijk
- Noem de branche als relevant
- Verwijs naar de offerte link
- Kort: max 150 woorden
- Geen "Geachte", gebruik de voornaam als beschikbaar
- Eindig met een uitnodiging om contact op te nemen bij vragen
- SCHRIJF GEEN HANDTEKENING — die wordt automatisch toegevoegd. Eindig je tekst vóór de afsluitgroet.

Geef ALLEEN de e-mailtekst in HTML format terug (geen subject, geen uitleg, GEEN afsluitgroet). Gebruik <p> tags.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    let html = message.content[0]?.text || "";

    // Strip eventuele afsluitgroet die Claude alsnog mocht toevoegen
    const strippablePatterns = [
      /<p[^>]*>\s*Met\s+(zonnige|vriendelijke|hartelijke)\s+groet[\s\S]*$/i,
      /<p[^>]*>\s*(Met\s+)?vriendelijke\s+groet[\s\S]*$/i,
      /<p[^>]*>\s*Kind\s+regards[\s\S]*$/i,
    ];
    for (const pat of strippablePatterns) {
      html = html.replace(pat, "");
    }

    // Plak de vaste handtekening achter de body
    html = html.trim().replace(/\s+$/, "") + `<p><br></p>${signatureHtml}`;

    // Generate subject
    const subjectPrompt = `Genereer een kort e-mail onderwerp (max 60 tekens) in ${langMap[lang]} voor het versturen van offerte ${quote.quote_number} aan ${lead?.company_name}. Branche: ${lead?.industry || "onbekend"}. Geef ALLEEN het onderwerp terug, geen aanhalingstekens.`;

    const subjectMsg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      messages: [{ role: "user", content: subjectPrompt }],
    });

    const subject = subjectMsg.content[0]?.text?.trim() || `Offerte ${quote.quote_number}`;

    return Response.json({ subject, body_html: html });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
