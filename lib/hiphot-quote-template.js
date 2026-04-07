import { getTranslations } from "@/lib/translations/quote";

/**
 * Generate HipHot quote HTML — professional layout, printable, multi-language.
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
}) {
  const tr = getTranslations(language);

  const formatEuro = (amount) =>
    `€ ${Number(amount || 0)
      .toFixed(2)
      .replace(".", ",")}`;

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString(language === "de" ? "de-DE" : language === "fr" ? "fr-FR" : language === "en" ? "en-GB" : "nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const itemRows = (lineItems || [])
    .filter((item) => (Number(item.quantity) || 0) > 0)
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;">
          <strong>${escHtml(item.name)}</strong>
          ${item.sku ? `<br><span style="color:#999;font-size:12px;">SKU: ${escHtml(item.sku)}</span>` : ""}
          ${item.description ? `<br><span style="color:#666;font-size:12px;">${escHtml(item.description)}</span>` : ""}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px;">${item.quantity}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;">${formatEuro(item.unit_price)}</td>
        ${Number(item.discount_pct) > 0 ? `<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px;color:#e67e22;">${item.discount_pct}%</td>` : `<td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:14px;color:#ccc;">-</td>`}
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:14px;font-weight:600;">${formatEuro(item.line_total)}</td>
      </tr>`
    )
    .join("");

  const shippingRow =
    totals.verzendkostenOntvangen > 0
      ? `<tr><td colspan="4" style="padding:8px 12px;text-align:right;font-size:14px;">${tr.shipping}</td><td style="padding:8px 12px;text-align:right;font-size:14px;">${formatEuro(totals.verzendkostenOntvangen)}</td></tr>`
      : `<tr><td colspan="4" style="padding:8px 12px;text-align:right;font-size:14px;color:#27ae60;">${tr.shippingFree}</td><td style="padding:8px 12px;text-align:right;font-size:14px;color:#27ae60;">€ 0,00</td></tr>`;

  const branchSection = branchText
    ? `<div style="margin:32px 0;padding:24px;background:#fffbf0;border-left:4px solid #f5a623;border-radius:8px;">
        ${branchText.title ? `<h3 style="margin:0 0 12px;font-size:18px;color:#333;">${escHtml(branchText.title)}</h3>` : ""}
        <div style="font-size:14px;line-height:1.7;color:#555;">${branchText.body || ""}</div>
      </div>`
    : "";

  const remarksSection = quote.remarks_html
    ? `<div style="margin:24px 0;padding:20px;background:#f8f9fa;border-radius:8px;">
        <h3 style="margin:0 0 8px;font-size:16px;color:#333;">${tr.remarks}</h3>
        <div style="font-size:14px;line-height:1.6;color:#555;">${quote.remarks_html}</div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tr.quote} ${quote.quote_number || ""}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, sans-serif; color: #333; background: #fff; }
  @media print {
    body { background: #fff; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }
</style>
</head>
<body>
<div style="max-width:800px;margin:0 auto;padding:40px 32px;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:3px solid #f5a623;">
    <div>
      <img src="https://hiphot.nl/wp-content/uploads/2023/06/HipHot-Logo-PNG-300x131.png" alt="HipHot" style="height:60px;margin-bottom:12px;" />
      <div style="font-size:12px;color:#999;">
        HipHot B.V.<br>
        info@hiphot.nl<br>
        www.hiphot.nl
      </div>
    </div>
    <div style="text-align:right;">
      <h1 style="font-size:28px;font-weight:700;color:#333;margin-bottom:8px;">${tr.quote}</h1>
      <table style="margin-left:auto;font-size:13px;color:#666;">
        <tr><td style="padding:2px 12px 2px 0;text-align:right;">${tr.quoteNumber}:</td><td style="font-weight:600;">${escHtml(quote.quote_number || "")}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;text-align:right;">${tr.date}:</td><td>${formatDate(quote.created_at)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;text-align:right;">${tr.validUntil}:</td><td>${formatDate(quote.valid_until)}</td></tr>
      </table>
    </div>
  </div>

  <!-- Client info -->
  <div style="display:flex;gap:40px;margin-bottom:32px;">
    <div style="flex:1;">
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">${tr.to}</h3>
      <div style="font-size:14px;line-height:1.6;">
        <strong>${escHtml(lead.company_name || "")}</strong><br>
        ${escHtml(quote.contact_name || lead.contact_person || "")}<br>
        ${(quote.contact_email || lead.email) ? `${escHtml(quote.contact_email || lead.email)}<br>` : ""}
        ${(quote.contact_phone || lead.phone) ? escHtml(quote.contact_phone || lead.phone) : ""}
      </div>
    </div>
    <div style="flex:1;">
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:8px;">${tr.from}</h3>
      <div style="font-size:14px;line-height:1.6;">
        <strong>HipHot B.V.</strong><br>
        ${escHtml(quote.contact_title || "")}<br>
        hallo@hiphot.nl<br>
        +31 (0)85 060 3"; // placeholder
      </div>
    </div>
  </div>

  ${branchSection}

  <!-- Products table -->
  <h2 style="font-size:18px;font-weight:600;margin-bottom:16px;color:#333;">${tr.productsAndServices}</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#f8f9fa;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #eee;">${tr.product}</th>
        <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #eee;">${tr.quantity}</th>
        <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #eee;">${tr.unitPrice}</th>
        <th style="padding:10px 12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #eee;">${tr.discount}</th>
        <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#999;border-bottom:2px solid #eee;">${tr.total}</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr style="border-top:2px solid #eee;">
        <td colspan="4" style="padding:10px 12px;text-align:right;font-size:14px;">${tr.subtotal}</td>
        <td style="padding:10px 12px;text-align:right;font-size:14px;font-weight:600;">${formatEuro(totals.nettoNaArtikelKorting)}</td>
      </tr>
      ${shippingRow}
      <tr>
        <td colspan="4" style="padding:8px 12px;text-align:right;font-size:14px;">${tr.vat}</td>
        <td style="padding:8px 12px;text-align:right;font-size:14px;">${formatEuro(totals.btw)}</td>
      </tr>
      <tr style="background:#f5a623;color:#fff;">
        <td colspan="4" style="padding:14px 12px;text-align:right;font-size:16px;font-weight:700;border-radius:0 0 0 8px;">${tr.totalIncVat}</td>
        <td style="padding:14px 12px;text-align:right;font-size:16px;font-weight:700;border-radius:0 0 8px 0;">${formatEuro(totals.totaalInclBtw)}</td>
      </tr>
    </tfoot>
  </table>

  ${remarksSection}

  <!-- Terms -->
  <div style="margin:32px 0;padding:20px;background:#f8f9fa;border-radius:8px;">
    <h3 style="font-size:14px;font-weight:600;margin-bottom:8px;">${tr.terms}</h3>
    <p style="font-size:13px;line-height:1.6;color:#666;">${tr.termsText}</p>
  </div>

  <!-- Questions -->
  <div style="text-align:center;padding:24px 0;color:#999;font-size:13px;">
    <p><strong>${tr.questions}</strong> ${tr.questionsText}</p>
    <p style="margin-top:4px;">hallo@hiphot.nl &middot; www.hiphot.nl</p>
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
