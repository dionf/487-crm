// Welke items per bedrijf een regel "Waarom dit interessant is" krijgen.
// Zonder serverimports, zodat de campagnepagina dezelfde regels gebruikt.

export const RELEVANCE_SCORES = ["sterk", "mogelijk", "niet"];
export const DEFAULT_MAX_ITEM_LINES = 3;
export const MAX_ITEM_LINES_LIMIT = 20;

// Maximum aantal itemregels van een campagne; campagnes van vóór de
// instelling (of zonder kolom) krijgen de standaard.
export function maxItemLines(campaign) {
  const value = Number.parseInt(campaign?.max_item_lines, 10);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_ITEM_LINES;
  return Math.min(value, MAX_ITEM_LINES_LIMIT);
}

// Plan per opzet:
//   intro    geen itemregels
//   per_item bij elk item een regel
//   combined items "voor iedereen" altijd, daarna de AI-keuze tot het maximum.
//            Staan er meer items op "voor iedereen" dan het maximum, dan
//            krijgen die allemaal een regel en kiest de AI er geen bij.
export function itemLinePlan(campaign, items = []) {
  const layout = campaign?.personalization_layout || "combined";
  if (layout === "intro") return { layout, max: 0, forced: [], free: 0, overflow: false };
  if (layout === "per_item") return { layout, max: items.length, forced: items, free: 0, overflow: false };
  const max = maxItemLines(campaign);
  const forced = items.filter((item) => item.personalize_all);
  return { layout, max, forced, free: Math.max(0, max - forced.length), overflow: forced.length > max };
}
