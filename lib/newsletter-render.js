import { SECTION_LABELS, SECTION_ORDER, itemSlot, sortItems } from "@/lib/newsletter-personalize";

// E-mailveilige HTML (tabellen, inline styles) voor een gepersonaliseerde
// nieuwsbrief, in de stijl van de 48-7-homepage: witte kaart, amber accenten,
// afbeeldingen per item en het logo van het ontvangende bedrijf bij de
// persoonlijke blokken. De opzet volgt campaign.personalization_layout; alleen
// aanwezige slots worden getoond.

const FONT = "'Geist',-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const C = {
  page: "#F4F4F4",
  ink: "#0D0D0F",
  text: "#292828",
  muted: "#6B7280",
  amber: "#FAB868",
  burnt: "#D4731C",
  badgeBg: "#FFF8EE",
  badgeBorder: "#FAD9A8",
  card: "rgba(0,0,0,0.08)",
  rule: "#EFEFEF",
};
const BOOKING_URL = "https://outlook.office.com/book/Ge35be38210e149b8bc1c6394d37111b6@48-7.nl/";
const WIDTH = 600;
const GUTTER = 32;
const INNER = WIDTH - GUTTER * 2;

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://crm.48-7.nl").replace(/\/$/, "");
}

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

// *woorden* in de kop krijgen het amber accent, zoals op de homepage.
function headlineHtml(value) {
  return esc(value).replace(/\*([^*]+)\*/g, `<span style="color:${C.amber};">$1</span>`);
}

// Sectielabel zoals op de homepage: zwarte stip met amber kern + kleine hoofdletters.
function sectionLabel(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td valign="middle" style="padding-right:8px;"><div style="width:14px;height:14px;border-radius:7px;background:${C.ink};text-align:center;line-height:14px;font-size:0;"><span style="display:inline-block;width:4px;height:4px;border-radius:2px;background:${C.amber};vertical-align:middle;"></span></div></td>
  <td valign="middle" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${C.muted};">${esc(text)}</td>
</tr></table>`;
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

function logoCell(logoUrl, companyName, size) {
  const url = safeUrl(logoUrl);
  if (!url) return "";
  // Vaste hoogte, breedte volgt het logo (ook brede woordmerken blijven leesbaar).
  return `<td valign="middle" style="padding-right:12px;width:1%;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" valign="middle" style="background:#ffffff;border:1px solid ${C.badgeBorder};border-radius:10px;padding:7px 9px;">
      <img src="${esc(url)}" alt="${esc(companyName)}" height="${size}" style="display:block;height:${size}px;width:auto;max-width:${size * 4}px;border:0;outline:none;">
    </td>
  </tr></table>
</td>`;
}

// Persoonlijk blok: amber-tint zoals de hero-badge op de homepage, met het
// logo van het bedrijf voor herkenning.
function personalBlock(label, text, { logoUrl, companyName, large = false }) {
  const logo = logoCell(logoUrl, companyName, large ? 36 : 28);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="background:${C.badgeBg};border:1px solid ${C.badgeBorder};border-radius:${large ? 16 : 12}px;padding:${large ? "20px 22px" : "14px 16px"};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${logo}
      <td valign="middle" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.burnt};">${esc(label)}</td>
    </tr></table>
    <div style="font-family:${FONT};font-size:${large ? 16 : 14}px;line-height:1.6;color:${C.text};padding-top:${large ? 12 : 10}px;">${paragraphs(text)}</div>
  </td></tr>
</table>`;
}

function itemCard(item, personalText, company) {
  const url = safeUrl(item.url);
  const image = safeUrl(item.image_url);
  const cardWidth = INNER - 2;
  const imageHtml = image
    ? `<tr><td style="padding:0;font-size:0;line-height:0;">${url ? `<a href="${esc(url)}" style="text-decoration:none;">` : ""}<img src="${esc(image)}" alt="${esc(item.title)}" width="${cardWidth}" style="display:block;width:100%;max-width:${cardWidth}px;height:auto;border:0;border-radius:16px 16px 0 0;">${url ? "</a>" : ""}</td></tr>`
    : "";
  return `<tr><td style="padding-top:16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.card};border-radius:16px;border-collapse:separate;">
    ${imageHtml}
    <tr><td style="padding:22px 24px 24px 24px;">
      <div style="font-family:${FONT};font-size:20px;line-height:1.3;font-weight:600;color:${C.ink};">${url ? `<a href="${esc(url)}" style="color:${C.ink};text-decoration:none;">${esc(item.title)}</a>` : esc(item.title)}</div>
      ${item.body ? `<div style="font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text};padding-top:8px;">${paragraphs(item.body)}</div>` : ""}
      ${url ? `<div style="padding-top:12px;"><a href="${esc(url)}" style="font-family:${FONT};font-size:14px;font-weight:600;color:${C.burnt};text-decoration:none;">${esc(item.link_label || "Lees meer")} &rarr;</a></div>` : ""}
      ${personalText ? `<div style="padding-top:16px;">${personalBlock(`Waarom dit interessant is voor ${company.name}`, personalText, { logoUrl: company.logoUrl, companyName: company.name })}</div>` : ""}
    </td></tr>
  </table>
</td></tr>`;
}

function sectionBlock(section, items, slotText, company) {
  return `<tr><td style="padding:28px ${GUTTER}px 4px ${GUTTER}px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td>${sectionLabel(SECTION_LABELS[section] || section)}</td></tr>
    ${items.map((item) => itemCard(item, slotText(itemSlot(item.id)), company)).join("\n")}
  </table>
</td></tr>`;
}

/**
 * @param {object} args
 * @param {object} args.campaign      newsletter_campaigns-rij (subject, preview_text, headline, intro_text, layout, hero_image_url)
 * @param {object[]} args.items       newsletter_campaign_items
 * @param {object[]} args.slots       personalisaties van dit bedrijf (slot + content.text)
 * @param {object} args.company       { company_name, logo_url }
 * @param {object} [args.recipient]   { name, email } voor de aanhef
 * @param {string} [args.unsubscribeUrl]
 * @param {string} [args.webVersionUrl] link naar de webversie van deze mail
 * @returns {{ subject: string, preheader: string, html: string }}
 */
export function renderPersonalizedNewsletter({ campaign, items, slots, company, recipient, unsubscribeUrl, webVersionUrl }) {
  const bySlot = new Map((slots || []).map((slot) => [slot.slot, slot.content?.text || ""]));
  const slotText = (slot) => bySlot.get(slot) || "";
  const companyInfo = { name: company?.company_name || "jullie", logoUrl: company?.logo_url || null };
  const subject = slotText("subject") || campaign.subject || "";
  const preheader = slotText("preheader") || campaign.preview_text || "";
  const name = firstName(recipient);
  const greeting = `${name ? `Hoi ${esc(name)}` : "Hoi"}, ${esc(campaign.intro_text || "hier is je update van 48-7: nieuws van ons, het belangrijkste AI-nieuws en een paar tips die je morgen kunt gebruiken.")}`;
  // Opzet "per item" heeft geen intro-blok, ook niet als er nog een oud slot is.
  const intro = campaign.personalization_layout === "per_item" ? "" : slotText("intro");
  const hero = safeUrl(campaign.hero_image_url);

  const sorted = sortItems(items);
  const sections = SECTION_ORDER
    .map((section) => [section, sorted.filter((item) => item.section === section)])
    .filter(([, sectionItems]) => sectionItems.length)
    .map(([section, sectionItems]) => sectionBlock(section, sectionItems, slotText, companyInfo))
    .join("\n");

  const footerLinks = [
    unsubscribeUrl ? `<a href="${esc(unsubscribeUrl)}" style="color:#9CA3AF;text-decoration:underline;">Uitschrijven</a>` : "",
    webVersionUrl ? `<a href="${esc(webVersionUrl)}" style="color:#9CA3AF;text-decoration:underline;">Bekijk in je browser</a>` : "",
    `<a href="https://48-7.nl" style="color:#9CA3AF;text-decoration:underline;">48-7.nl</a>`,
  ].filter(Boolean).join(" &middot; ");

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @media (max-width:620px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td style="padding:24px 12px 32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${WIDTH}px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);">
  <tr><td class="px" style="padding:24px ${GUTTER}px 20px ${GUTTER}px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><a href="https://48-7.nl" style="text-decoration:none;"><img src="${appBaseUrl()}/email/48-7-logo.png" alt="48-7 AI Professionals" width="165" height="25" style="display:block;width:165px;height:auto;border:0;"></a></td>
      <td align="right" valign="middle" style="font-family:${FONT};font-size:12px;font-weight:500;color:${C.muted};white-space:nowrap;">Nieuwsbrief &middot; ${esc(editionLabel(campaign))}</td>
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:0 ${GUTTER}px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.ink};border-radius:20px;border-collapse:separate;">
      ${hero ? `<tr><td style="font-size:0;line-height:0;"><img src="${esc(hero)}" alt="" width="${INNER}" style="display:block;width:100%;max-width:${INNER}px;height:auto;border:0;border-radius:20px 20px 0 0;"></td></tr>` : ""}
      <tr><td style="padding:30px 28px 32px 28px;">
        <span style="display:inline-block;background:rgba(250,184,104,0.14);border:1px solid rgba(250,184,104,0.45);color:${C.amber};font-family:${FONT};font-size:12px;font-weight:600;padding:5px 12px;border-radius:9999px;">AI-update voor ${esc(companyInfo.name)}</span>
        <h1 class="h1" style="margin:18px 0 0 0;font-family:${FONT};font-size:34px;line-height:1.15;font-weight:700;letter-spacing:-0.8px;color:#ffffff;">${headlineHtml(campaign.headline || "Wat er deze maand *speelt in AI*")}</h1>
        <p style="margin:14px 0 0 0;font-family:${FONT};font-size:16px;line-height:1.6;color:#B3B3B8;">${greeting}</p>
      </td></tr>
    </table>
  </td></tr>
  ${intro ? `<tr><td class="px" style="padding:20px ${GUTTER}px 0 ${GUTTER}px;">${personalBlock(`In deze nieuwsbrief voor ${companyInfo.name}`, intro, { logoUrl: companyInfo.logoUrl, companyName: companyInfo.name, large: true })}</td></tr>` : ""}
  ${sections}
  <tr><td class="px" style="padding:32px ${GUTTER}px 32px ${GUTTER}px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:${C.badgeBg};border:1px solid ${C.badgeBorder};border-radius:9999px;padding:14px 22px;font-family:${FONT};font-size:15px;line-height:1.5;color:${C.text};">
        Geïnspireerd? <a href="${BOOKING_URL}" style="color:${C.burnt};font-weight:600;text-decoration:none;">Plan een vrijblijvende afspraak in onze agenda &rarr;</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="px" style="background:${C.ink};padding:26px ${GUTTER}px 28px ${GUTTER}px;">
    <p style="margin:0 0 6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;">48-7 AI Professionals</p>
    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:#9CA3AF;">Je ontvangt deze nieuwsbrief omdat ${esc(companyInfo.name)} met 48-7 samenwerkt of contact met ons heeft gehad.<br>${footerLinks}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, preheader, html };
}
