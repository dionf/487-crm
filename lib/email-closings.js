// Aanhef, afsluiting en getalnotatie per taal.
//
// Gedeeld door de AI-gegenereerde offerte-mail (app/api/quotes/[id]/generate-email)
// en de handmatige EmailCompose, zodat beide paden dezelfde talen dekken. De
// talen komen overeen met langMap in de generate-email route — staat een taal
// daar wel en hier niet, dan krijgt een Franse mail een Nederlandse afsluiting.

const CLOSINGS = {
  nl: { hiphot: "Met zonnige groet,", default: "Met vriendelijke groet," },
  de: { hiphot: "Mit sonnigen Grüßen,", default: "Mit freundlichen Grüßen," },
  en: { hiphot: "With sunny regards,", default: "Kind regards," },
  fr: { hiphot: "Salutations ensoleillées,", default: "Cordialement," },
};

const GREETINGS = { nl: "Hallo", de: "Hallo", en: "Hi", fr: "Bonjour" };

const NUMBER_LOCALES = { nl: "nl-NL", de: "de-DE", en: "en-GB", fr: "fr-FR" };

export function emailClosing(language, tenant) {
  const byLang = CLOSINGS[language] || CLOSINGS.nl;
  return tenant === "hiphot" ? byLang.hiphot : byLang.default;
}

export function emailGreeting(language) {
  return GREETINGS[language] || GREETINGS.nl;
}

export function emailNumberLocale(language) {
  return NUMBER_LOCALES[language] || NUMBER_LOCALES.nl;
}
