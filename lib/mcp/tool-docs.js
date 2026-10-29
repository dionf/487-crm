// Uitleg per MCP-tool voor de pagina "Claude koppelen" (/mcp). Houd gelijk
// met lib/mcp/tools.js.
export const MCP_TOOL_DOCS = [
  { name: "crm_whoami", label: "Wie ben ik", description: "Laat zien als wie Claude werkt en in welke organisatie.", example: "Als wie ben je ingelogd in het CRM?" },
  { name: "crm_search_leads", label: "Leads zoeken", description: "Zoeken op bedrijfsnaam, contactpersoon of e-mail, met filters op status en service type.", example: "Zoek leads met 'bouw' in de naam." },
  { name: "crm_get_lead", label: "Lead bekijken", description: "Alle details van een bedrijf: contact, trajecten, offertes, notities, bijlagen en activiteiten.", example: "Wat is de stand van zaken bij Bakkerij Jansen?" },
  { name: "crm_create_lead", label: "Lead aanmaken", description: "Nieuw bedrijf met contactpersoon toevoegen.", example: "Maak een lead aan voor Van Dijk Installatietechniek, contact Piet van Dijk." },
  { name: "crm_update_lead", label: "Lead bijwerken", description: "Contactgegevens, status of waarde aanpassen.", example: "Zet Bakkerij Jansen op gekwalificeerd." },
  { name: "crm_add_note", label: "Notitie of to-do", description: "Gespreksverslag, interne notitie of to-do met deadline vastleggen.", example: "Maak een to-do bij Jansen: offerte nabellen vrijdag." },
  { name: "crm_list_todos", label: "To-do's", description: "Je openstaande to-do's, of die van het hele team.", example: "Wat staat er deze week op mijn to-do-lijst?" },
  { name: "crm_list_follow_ups", label: "Follow-ups", description: "Openstaande follow-up taken, zoals offertes nabellen.", example: "Welke follow-ups staan er open?" },
  { name: "crm_pipeline_metrics", label: "Pipeline", description: "Actieve waarde, gewonnen, verloren en win rate per service type.", example: "Hoe staat de pipeline ervoor?" },
  { name: "crm_create_opportunity", label: "Traject starten", description: "Nieuwe deal bij een bestaand bedrijf.", example: "Start een traject 'Training team' bij Jansen." },
  { name: "crm_update_opportunity", label: "Traject bijwerken", description: "Status, waarde of reden gewonnen/verloren van een traject.", example: "Zet het traject 'Training team' op gewonnen." },
  { name: "crm_create_quote", label: "Offerte aanmaken", description: "Conceptofferte met bedrag en omschrijving; opmaken en versturen doe je in het CRM.", example: "Maak een conceptofferte van €2.500 voor Jansen." },
  { name: "crm_list_quotes", label: "Offertes", description: "Openstaande offertes, op status of bijna verlopen.", example: "Welke offertes verlopen binnen 14 dagen?" },
  { name: "crm_add_attachment", label: "Bijlage toevoegen", description: "Bestand tot 3 MB bij een lead opslaan.", example: "Voeg deze PDF toe als bijlage bij Jansen." },
  { name: "crm_check_inbox", label: "Inbox checken", description: "Nieuwe e-mails in de leads-inbox van je organisatie verwerken.", example: "Check de leads-inbox." },
];
