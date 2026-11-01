"use client";

// Vaste plek voor de acties van een campagne (testmail, ontvangers,
// verzenden), op de campagnepagina voor beide soorten nieuwsbrieven.
export default function CampaignActionBar({ children }) {
  return (
    <div className="bg-white border border-gray-100 rounded-card p-3 flex flex-col sm:flex-row flex-wrap gap-2 sm:items-center">
      {children}
    </div>
  );
}

export const actionButtonClass = "flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-50";
