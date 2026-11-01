"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EDITABLE_STATUSES } from "@/lib/newsletter-status";
import PersonalizedContentEditor from "@/components/newsletter/PersonalizedContentEditor";
import PersonalizationReview from "@/components/newsletter/PersonalizationReview";
import PersonalizedPreview from "@/components/newsletter/PersonalizedPreview";
import SocialPosts from "@/components/newsletter/SocialPosts";

const TABS = [
  { id: "content", label: "1. Inhoud" },
  { id: "review", label: "2. Personalisatie" },
  { id: "preview", label: "3. Voorbeeld en verzenden" },
  { id: "social", label: "4. Social posts (optioneel)" },
];

// Werkruimte voor een gepersonaliseerde campagne: items schrijven,
// personalisatie per bedrijf reviewen, voorbeeld bekijken en verzenden, en
// optioneel social posts bij items maken. tab/onTabChange zijn optioneel: de
// campagnepagina gebruikt ze om vanuit de actiebalk naar stap 3 te springen.
export default function PersonalizedCampaignPanel({
  campaign,
  refreshKey = 0,
  resendReady,
  testEmail,
  setTestEmail,
  accent,
  onCampaignChange,
  tab: controlledTab,
  onTabChange,
  onProgress,
}) {
  const [ownTab, setOwnTab] = useState("content");
  const tab = controlledTab ?? ownTab;
  const setTab = onTabChange ?? setOwnTab;
  const [items, setItems] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const editable = EDITABLE_STATUSES.has(campaign.status);

  const reload = useCallback(async () => {
    setError("");
    try {
      const [itemsRes, personalizationRes, campaignRes] = await Promise.all([
        apiFetch(`/api/newsletter/campaigns/${campaign.id}/items`),
        apiFetch(`/api/newsletter/campaigns/${campaign.id}/personalizations`),
        apiFetch(`/api/newsletter/campaigns/${campaign.id}`),
      ]);
      const [itemsJson, personalizationJson, campaignJson] = await Promise.all([
        itemsRes.json(),
        personalizationRes.json(),
        campaignRes.json(),
      ]);
      if (!itemsRes.ok) throw new Error(itemsJson.error || "Items laden mislukt");
      if (!personalizationRes.ok) throw new Error(personalizationJson.error || "Personalisatie laden mislukt");
      setItems(itemsJson.items || []);
      setData(personalizationJson);
      onProgress?.(personalizationJson.progress || null);
      // Inhoud wijzigen kan de status terugzetten (testmail vervalt).
      if (campaignRes.ok && campaignJson.campaign) onCampaignChange(campaignJson.campaign);
    } catch (err) {
      setError(err.message);
    }
    // onCampaignChange en onProgress zijn nieuwe functies bij elke render van de pagina.
    // refreshKey: de pagina vraagt om opnieuw laden (bijv. na opslaan instellingen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id, refreshKey]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  const progress = data?.progress;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                tab === item.id ? "bg-white text-brand-orange shadow-sm" : "text-gray-500 hover:text-brand-black"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {items.length} items
          {progress ? ` · ${progress.approved}/${progress.total} bedrijven goedgekeurd` : ""}
        </p>
      </div>
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

      {tab === "content" && <PersonalizedContentEditor campaign={campaign} editable={editable} onChanged={reload} />}
      {tab === "review" && (
        <PersonalizationReview campaign={campaign} editable={editable} data={data} items={items} onReload={reload} />
      )}
      {tab === "preview" && (
        <PersonalizedPreview
          campaign={campaign}
          data={data}
          resendReady={resendReady}
          testEmail={testEmail}
          setTestEmail={setTestEmail}
          accent={accent}
          onCampaignChange={onCampaignChange}
        />
      )}
      {tab === "social" && <SocialPosts campaign={campaign} items={items} />}
    </div>
  );
}
