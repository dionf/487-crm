import { SECTION_LABELS, SECTION_ORDER, itemSlot, sortItems } from "@/lib/newsletter-personalize";

// E-mailveilige HTML (tabellen, inline styles) voor een gepersonaliseerde
// nieuwsbrief, gebaseerd op mockup C in docs/newsletter-mockups/. De opzet volgt
// campaign.personalization_layout; alleen aanwezige slots worden getoond.

const FONT = "'Geist',-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const C = {
  page: "#F4F4F4",
  ink: "#0D0D0F",
  text: "#292828",
  muted: "#6B7280",
  amber: "#FAB868",
  amberText: "#D4731C",
  personal: "#FAF8F5",
  rule: "#E5E5E5",
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraphs(value) {
  return esc(value).replace(/\r?\n\r?\n/g, "<br><br>").replace(/\r?\n/g, "<br>");
}

function safeUrl(url) {
  const value = String(url || "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

function firstName(recipient) {
  const name = String(recipient?.name || "").trim();
  if (!name || name.includes("@")) return "";
  return name.split(/\s+/)[0];
}

function editionLabel(campaign) {
  const date = campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date();
  return date.toLocaleDateString("nl-NL", { month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}

function personalBlock(label, text, { large = false } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:${C.personal};border-left:3px solid ${C.amber};border-radius:${large ? 12 : 10}px;padding:${large ? "20px 22px" : "12px 16px"};">
    <div style="font-family:${FONT};font-size:${large ? 11 : 10}px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.amberText};margin-bottom:${large ? 8 : 4}px;">${esc(label)}</div>
    <div style="font-family:${FONT};font-size:${large ? 15 : 14}px;line-height:1.55;color:${C.text};">${paragraphs(text)}</div>
  </td></tr>
</table>`;
}

function itemBlock(item, personalText, companyName, isLast) {
  const url = safeUrl(item.url);
  return `<tr><td style="padding-top:4px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="font-family:${FONT};font-size:18px;line-height:1.35;font-weight:600;color:${C.ink};padding-top:18px;">${esc(item.title)}</td></tr>
    ${item.body ? `<tr><td style="font-family:${FONT};font-size:15px;line-height:1.6;color:${C.text};padding-top:6px;">${paragraphs(item.body)}</td></tr>` : ""}
    ${url ? `<tr><td style="padding-top:8px;"><a href="${esc(url)}" style="font-family:${FONT};font-size:14px;font-weight:600;color:${C.amberText};text-decoration:none;">${esc(item.link_label || "Lees meer")} &rarr;</a></td></tr>` : ""}
    ${personalText ? `<tr><td style="padding-top:12px;">${personalBlock(`Waarom interessant voor ${companyName}`, personalText)}</td></tr>` : ""}
    ${isLast ? "" : `<tr><td style="padding-top:22px;border-bottom:1px solid #EFEFEF;font-size:0;line-height:0;">&nbsp;</td></tr>`}
  </table>
</td></tr>`;
}

function sectionBlock(section, items, slotText, companyName) {
  return `<tr><td style="padding:16px 32px 8px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding-top:12px;"><span style="display:inline-block;background:#FEF3C7;color:#B45309;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:6px 12px;border-radius:9999px;">${esc(SECTION_LABELS[section] || section)}</span></td></tr>
    ${items.map((item, index) => itemBlock(item, slotText(itemSlot(item.id)), companyName, index === items.length - 1)).join("\n")}
  </table>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;"><div style="border-bottom:1px solid ${C.rule};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
}

/**
 * @param {object} args
 * @param {object} args.campaign      newsletter_campaigns-rij (subject, preview_text, headline, intro_text, layout)
 * @param {object[]} args.items       newsletter_campaign_items
 * @param {object[]} args.slots       personalisaties van dit bedrijf (slot + content.text)
 * @param {object} args.company       { company_name }
 * @param {object} [args.recipient]   { name, email } voor de aanhef
 * @param {string} [args.unsubscribeUrl]
 * @returns {{ subject: string, preheader: string, html: string }}
 */
export function renderPersonalizedNewsletter({ campaign, items, slots, company, recipient, unsubscribeUrl }) {
  const bySlot = new Map((slots || []).map((slot) => [slot.slot, slot.content?.text || ""]));
  const slotText = (slot) => bySlot.get(slot) || "";
  const companyName = company?.company_name || "jullie";
  const subject = slotText("subject") || campaign.subject || "";
  const preheader = slotText("preheader") || campaign.preview_text || "";
  const name = firstName(recipient);
  const greeting = `${name ? `Hoi ${esc(name)}` : "Hoi"}, ${esc(campaign.intro_text || "hier is je update van 48-7: nieuws van ons, het belangrijkste AI-nieuws en een paar tips die je morgen kunt gebruiken.")}`;
  // Opzet "per item" heeft geen intro-blok, ook niet als er nog een oud slot is.
  const intro = campaign.personalization_layout === "per_item" ? "" : slotText("intro");

  const sorted = sortItems(items);
  const sections = SECTION_ORDER
    .map((section) => [section, sorted.filter((item) => item.section === section)])
    .filter(([, sectionItems]) => sectionItems.length)
    .map(([section, sectionItems]) => sectionBlock(section, sectionItems, slotText, companyName))
    .join("\n");

  const unsubscribe = unsubscribeUrl
    ? `<a href="${esc(unsubscribeUrl)}" style="color:#9CA3AF;text-decoration:underline;">Uitschrijven</a> &middot; `
    : "";

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);">
  <tr><td style="height:4px;background:${C.amber};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 32px 8px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};font-size:22px;font-weight:700;color:${C.ink};letter-spacing:-0.5px;">48-7 <span style="font-size:13px;font-weight:500;color:${C.muted};letter-spacing:0;">AI Professionals</span></td>
      <td align="right" style="font-family:${FONT};font-size:12px;font-weight:500;color:${C.muted};">Nieuwsbrief &middot; ${esc(editionLabel(campaign))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:20px 32px 4px 32px;">
    <h1 style="margin:0;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:700;color:${C.ink};">${esc(campaign.headline || "Wat er deze maand speelt in AI")}</h1>
    <p style="margin:10px 0 18px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.muted};">${greeting}</p>
  </td></tr>
  ${intro ? `<tr><td style="padding:0 32px 8px 32px;">${personalBlock(`In deze nieuwsbrief voor ${companyName}`, intro, { large: true })}</td></tr>` : ""}
  ${sections}
  <tr><td align="center" style="padding:32px 32px 36px 32px;">
    <p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.5;color:${C.ink};font-weight:600;">Benieuwd wat AI voor jullie kan doen?</p>
    <a href="https://48-7.nl/contact" style="display:inline-block;background:${C.amber};color:${C.ink};font-family:${FONT};font-size:15px;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:9999px;">Plan een kort gesprek</a>
  </td></tr>
  <tr><td style="background:${C.ink};padding:24px 32px;">
    <p style="margin:0 0 6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;">48-7 AI Professionals</p>
    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:#9CA3AF;">Je ontvangt deze mail omdat ${esc(companyName)} contact heeft gehad met 48-7.<br>
    ${unsubscribe}<a href="https://48-7.nl" style="color:#9CA3AF;text-decoration:underline;">48-7.nl</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, preheader, html };
}
