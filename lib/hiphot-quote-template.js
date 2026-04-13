import { getTranslations } from "@/lib/translations/quote";

/**
 * Generate HipHot quote HTML — yellow header HipHot huisstijl, printable, multi-language.
 * Internal data (inkoop, marge) is NEVER included.
 */
export function generateQuoteHtml({
  quote,
  lead,
  lineItems,
  totals,
  branchText,
  language = "nl",
  settings = {},
  introHtml = "",
  termsHtml = "",
}) {
  const tr = getTranslations(language);

  const formatEuro = (amount) =>
    `€ ${Number(amount || 0)
      .toFixed(2)
      .replace(".", ",")}`;

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString(
      language === "de" ? "de-DE" : language === "fr" ? "fr-FR" : language === "en" ? "en-GB" : "nl-NL",
      { day: "numeric", month: "long", year: "numeric" }
    );
  };

  const referentie =
    quote.quote_number ||
    `${new Date(quote.created_at || Date.now())
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14)}`;

  // Title from line items / description
  const quoteTitle =
    quote.title ||
    (lead?.company_name ? `${lead.company_name} - zonnebrandcreme dispensers` : tr.quote);

  const itemRows = (lineItems || [])
    .filter((item) => (Number(item.quantity) || 0) > 0)
    .map(
      (item) => `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;vertical-align:top;">
          <div style="font-weight:600;color:#1a1a1a;">${escHtml(item.name)}${item.sku ? ` (${escHtml(item.sku)})` : ""}</div>
          ${item.description ? `<div style="color:#777;font-size:12px;margin-top:4px;line-height:1.5;">${escHtml(item.description)}</div>` : ""}
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px;vertical-align:top;">${item.quantity}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;vertical-align:top;">${formatEuro(item.unit_price)}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;font-weight:600;vertical-align:top;">${formatEuro(item.line_total)}${Number(item.discount_pct) > 0 ? `<div style="font-size:11px;color:#999;font-weight:400;">na ${item.discount_pct}% korting</div>` : ""}</td>
      </tr>`
    )
    .join("");

  const shippingRow =
    totals.verzendkostenOntvangen > 0
      ? `<tr><td colspan="3" style="padding:10px 12px;text-align:right;font-size:14px;color:#555;">${tr.shipping}</td><td style="padding:10px 12px;text-align:right;font-size:14px;">${formatEuro(totals.verzendkostenOntvangen)}</td></tr>`
      : `<tr><td colspan="3" style="padding:10px 12px;text-align:right;font-size:14px;color:#555;">${tr.shipping}</td><td style="padding:10px 12px;text-align:right;font-size:14px;color:#777;">€ 0,00<div style="font-size:11px;">na 100% korting</div></td></tr>`;

  // Use branchText body if provided, else fall back to global intro
  const intro =
    (branchText?.body && branchText.body.trim()) ||
    (introHtml && introHtml.trim()) ||
    "";

  const introTitle = branchText?.title || "";

  const introSection = intro
    ? `<div style="margin:0 0 32px;padding:24px 28px;background:#fff;border:1px solid #e5e5e5;border-radius:6px;">
        ${introTitle ? `<h3 style="margin:0 0 12px;font-size:16px;color:#1a1a1a;font-weight:700;">${escHtml(introTitle)}</h3>` : ""}
        <div style="font-size:14px;line-height:1.7;color:#444;">${intro}</div>
      </div>`
    : "";

  const termsSection = termsHtml
    ? `<div style="margin:36px 0 24px;">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:10px;color:#1a1a1a;">${tr.terms === "Voorwaarden" ? "Aankoopvoorwaarden" : tr.terms}</h3>
        <div style="font-size:13px;line-height:1.7;color:#555;">${termsHtml}</div>
      </div>`
    : "";

  const remarksSection = quote.remarks_html
    ? `<div style="margin:24px 0;padding:18px 22px;background:#fffbf0;border-radius:6px;border-left:3px solid #ffc107;">
        <div style="font-size:14px;line-height:1.6;color:#555;">${quote.remarks_html}</div>
      </div>`
    : "";

  const contactName = quote.contact_name || "Dion Fokkema";
  const contactTitle = quote.contact_title || "Chef creme";
  const contactEmail = quote.contact_email || "hallo@hiphot.nl";
  const contactPhone = quote.contact_phone || "+31855055664";

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tr.quote} ${escHtml(quote.quote_number || "")}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #1a1a1a; background: #f5f5f5; line-height: 1.5; }
  a { color: #1a1a1a; }
  .hh-page { max-width: 820px; margin: 0 auto; background: #fff; }
  .hh-header { background: #FFD500; padding: 32px 40px 36px; position: relative; }
  .hh-header h1 { font-size: 26px; line-height: 1.2; font-weight: 800; color: #0d0d0d; max-width: 70%; }
  .hh-header .hh-logo { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 24px; color: #0d0d0d; }
  .hh-header .hh-meta { display: flex; justify-content: space-between; gap: 32px; margin-top: 24px; font-size: 13px; color: #1a1a1a; }
  .hh-header .hh-meta strong { display: block; font-weight: 700; margin-bottom: 4px; }
  .hh-body { padding: 36px 40px 8px; }
  .hh-section-title { font-size: 16px; font-weight: 700; margin: 32px 0 14px; color: #1a1a1a; }
  table.hh-items { width: 100%; border-collapse: collapse; }
  table.hh-items thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #888; font-weight: 700; padding: 10px 12px; border-bottom: 2px solid #FFD500; text-align: left; }
  table.hh-items thead th:nth-child(2) { text-align: center; }
  table.hh-items thead th:nth-child(3),
  table.hh-items thead th:nth-child(4) { text-align: right; }
  .hh-totals { font-size: 14px; margin-top: 4px; }
  .hh-totals .hh-total-row { padding: 12px 12px; border-top: 2px solid #1a1a1a; font-weight: 700; font-size: 16px; }
  .hh-print-bar { display: flex; gap: 12px; padding: 28px 40px 40px; background: #fff; }
  .hh-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; border-radius: 4px; font-size: 14px; font-weight: 700; cursor: pointer; border: 0; text-decoration: none; }
  .hh-btn-primary { background: #FFD500; color: #0d0d0d; }
  .hh-btn-secondary { background: #fff; color: #0d0d0d; border: 1px solid #d4d4d4; }
  .hh-contact { padding: 28px 40px; border-top: 1px solid #eee; font-size: 14px; }
  .hh-contact .hh-avatar { width: 44px; height: 44px; background: #FFD500; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; color: #0d0d0d; margin-bottom: 12px; }
  @media print {
    body { background: #fff; }
    .hh-page { max-width: 100%; box-shadow: none; }
    .no-print, .hh-print-bar { display: none !important; }
  }
  @media (max-width: 640px) {
    .hh-header { padding: 24px 20px; }
    .hh-body { padding: 24px 20px 8px; }
    .hh-print-bar, .hh-contact { padding-left: 20px; padding-right: 20px; }
    .hh-header h1 { font-size: 22px; max-width: 100%; }
    .hh-header .hh-meta { flex-direction: column; gap: 16px; }
  }
</style>
</head>
<body>
<div class="hh-page">

  <!-- Yellow header -->
  <div class="hh-header">
    <div class="hh-logo"><img src="https://hiphot.nl/wp-content/uploads/2022/03/HipHot-logo-menu.png" alt="HipHot" style="height:44px;display:block;" /></div>
    <h1>${escHtml(quoteTitle)}</h1>
    <div class="hh-meta">
      <div>
        <strong>${escHtml(lead.company_name || "")}</strong>
        ${lead.contact_first_name && lead.contact_last_name
          ? `${escHtml(lead.contact_first_name)} ${escHtml(lead.contact_last_name)}<br>`
          : lead.contact_person ? `${escHtml(lead.contact_person)}<br>` : ""}
        ${lead.contact_function ? `${escHtml(lead.contact_function)}<br>` : ""}
        ${lead.email ? `${escHtml(lead.email)}<br>` : ""}
        ${lead.phone ? escHtml(lead.phone) : ""}
      </div>
      <div style="text-align:right;">
        Referentie: ${escHtml(referentie)}<br>
        Prijsopgave aangemaakt: ${formatDate(quote.created_at)}<br>
        Prijsopgave vervalt: ${formatDate(quote.valid_until)}<br>
        Prijsopgave aangemaakt door: ${escHtml(contactName)}<br>
        ${escHtml(contactTitle)}<br>
        ${escHtml(contactEmail)}<br>
        ${escHtml(contactPhone)}
      </div>
    </div>
  </div>

  <!-- Body -->
  <div class="hh-body">
    ${introSection}
    ${remarksSection}

    <h2 class="hh-section-title">${tr.productsAndServices}</h2>
    <table class="hh-items">
      <thead>
        <tr>
          <th>Item en beschrijving</th>
          <th>Hoeveelheid</th>
          <th>Prijs per eenheid</th>
          <th>Totaal</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
      <tfoot>
        ${shippingRow}
        <tr>
          <td colspan="3" style="padding:12px;text-align:right;font-size:14px;color:#555;">${tr.subtotal}</td>
          <td style="padding:12px;text-align:right;font-size:14px;font-weight:600;">${formatEuro(totals.nettoNaArtikelKorting)}</td>
        </tr>
        <tr class="hh-total-row">
          <td colspan="3" style="padding:14px 12px;text-align:right;border-top:2px solid #1a1a1a;">${tr.total}</td>
          <td style="padding:14px 12px;text-align:right;border-top:2px solid #1a1a1a;">${formatEuro(totals.nettoVerkoop)}</td>
        </tr>
      </tfoot>
    </table>

    ${termsSection}
  </div>

  <!-- Contact block -->
  <div class="hh-contact">
    <div style="font-weight:700;margin-bottom:12px;">Vragen? Neem contact met me op</div>
    <div>
      <strong>${escHtml(contactName)}</strong><br>
      ${escHtml(contactTitle)}<br>
      ${escHtml(contactEmail)}<br>
      ${escHtml(contactPhone)}
    </div>
    <div style="margin-top:18px;color:#777;font-size:13px;">
      HIPHOT<br>
      Speenkruidstraat 62<br>
      Groningen, 9731 GW<br>
      Nederland
    </div>
  </div>

  <!-- Trotse klanten -->
  <div style="padding:32px 40px;background:#fff;border-top:1px solid #eee;text-align:center;">
    <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:18px;">
      We zijn er trots op dat we deze organisaties mogen helpen met beschermen
    </div>
    <img src="https://hiphot.nl/wp-content/uploads/2022/06/logos-klanten.jpg" alt="Onze klanten" style="max-width:100%;height:auto;display:block;margin:0 auto;" />
  </div>

  <!-- Print/Download bar -->
  <div class="hh-print-bar">
    <button type="button" class="hh-btn hh-btn-primary" onclick="window.print()">${tr.download || "Downloaden"}</button>
    <button type="button" class="hh-btn hh-btn-secondary" onclick="window.print()">Prijsopgave afdrukken</button>
  </div>

</div>
</body>
</html>`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
