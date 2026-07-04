/**
 * HipHot pricing calculator — ported from prijscalculator_hh.html
 * Calculates line totals, order totals, fulfillment costs, and margins.
 */

const DEFAULT_SETTINGS = {
  verzendkosten: 5.99,       // wat WIJ betalen aan de fulfillment-partner
  gratis_drempel: 199.00,
  pickpack_vast: 2.20,
  pickpack_per_artikel: 0.40,
  // Wat de klant betaalt — land-afhankelijk:
  verzendkosten_klant_nlbe: 3.99,   // NL + BE
  verzendkosten_klant_eu: 4.95,     // overige EU-landen
};

/**
 * Bereken de verzendkosten die AAN DE KLANT worden doorberekend.
 * NL en BE: €3,99 · overige landen: €4,95 · vanaf €199 subtotal: gratis.
 * @param {string|null|undefined} country  ISO-2 landcode uit lead.delivery_country of billing_country
 * @param {number} brutoSubtotal          subtotaal excl. verzending
 * @param {Object} [settings]             optioneel hiphot_settings overrides
 * @returns {number} verzendkosten in EUR
 */
export function getShippingCost(country, brutoSubtotal, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (brutoSubtotal >= Number(s.gratis_drempel)) return 0;
  const cc = String(country || "NL").trim().toUpperCase();
  if (cc === "NL" || cc === "BE") return Number(s.verzendkosten_klant_nlbe);
  return Number(s.verzendkosten_klant_eu);
}

/**
 * Calculate totals per line item.
 * @param {Array} items - [{ quantity, unit_price, discount_pct, inkoop_price }]
 * @returns {Array} items with calculated fields added
 */
export function calculateLineTotals(items) {
  return items.map((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const discountPct = Number(item.discount_pct) || 0;
    const inkoopPrice = Number(item.inkoop_price) || 0;

    const bruto = quantity * unitPrice;
    const korting = bruto * (discountPct / 100);
    const netto = bruto - korting;
    const inkoopTotal = quantity * inkoopPrice;
    const marge = netto - inkoopTotal;
    const margePct = netto > 0 ? (marge / netto) * 100 : 0;

    return {
      ...item,
      bruto,
      korting,
      line_total: netto,
      inkoop_total: inkoopTotal,
      marge,
      marge_pct: margePct,
    };
  });
}

/**
 * Calculate order totals including fulfillment and margin.
 * Mirrors the exact logic from prijscalculator_hh.html calculateTotals().
 *
 * @param {Array} items - line items (output of calculateLineTotals)
 * @param {Object} settings - fulfillment settings from hiphot_settings table
 * @param {boolean} useFulfillment - whether to include pick&pack costs
 * @returns {Object} order totals
 */
export function calculateOrderTotals(items, settings = {}, useFulfillment = true, country = "NL") {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  let totaalAantal = 0;
  let inkoopTotaal = 0;
  let brutoVerkoop = 0;
  let artikelKortingen = 0;

  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const discountPct = Number(item.discount_pct) || 0;
    const inkoopPrice = Number(item.inkoop_price) || 0;

    totaalAantal += quantity;
    inkoopTotaal += quantity * inkoopPrice;

    const brutoArtikel = quantity * unitPrice;
    brutoVerkoop += brutoArtikel;
    artikelKortingen += brutoArtikel * (discountPct / 100);
  });

  const nettoNaArtikelKorting = brutoVerkoop - artikelKortingen;

  // Shipping: wij betalen altijd verzendkosten aan onze fulfillment-partner;
  // de klant betaalt alleen onder de gratis-drempel en het bedrag hangt af van
  // z'n land (NL/BE €3,99 · overige EU €4,95).
  const verzendkostenInkoop = Number(s.verzendkosten);
  const verzendkostenOntvangen = getShippingCost(country, brutoVerkoop, s);

  // Pick & pack only when fulfillment is enabled
  const pickpackVast = useFulfillment ? Number(s.pickpack_vast) : 0;
  const pickpackVariabel =
    useFulfillment && totaalAantal > 2
      ? (totaalAantal - 2) * Number(s.pickpack_per_artikel)
      : 0;

  const totaleInkoopkosten =
    inkoopTotaal + verzendkostenInkoop + pickpackVast + pickpackVariabel;

  // Net sales = after discounts + received shipping
  const nettoVerkoop = nettoNaArtikelKorting + verzendkostenOntvangen;

  const marge = nettoVerkoop - totaleInkoopkosten;
  const margePercentageVerkoop =
    nettoVerkoop > 0 ? (marge / nettoVerkoop) * 100 : 0;
  const margePercentageInkoop =
    totaleInkoopkosten > 0 ? (marge / totaleInkoopkosten) * 100 : 0;

  const btw = nettoVerkoop * 0.21;
  const totaalInclBtw = nettoVerkoop + btw;

  return {
    totaalAantal,
    inkoopTotaal,
    brutoVerkoop,
    artikelKortingen,
    nettoNaArtikelKorting,
    verzendkostenInkoop,
    verzendkostenOntvangen,
    pickpackVast,
    pickpackVariabel,
    totaleInkoopkosten,
    nettoVerkoop,
    marge,
    margePercentageVerkoop,
    margePercentageInkoop,
    btw,
    totaalInclBtw,
    aantalGeselecteerd: items.filter((i) => (Number(i.quantity) || 0) > 0).length,
  };
}
