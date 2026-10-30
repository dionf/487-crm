"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle, Loader2, Sparkles } from "lucide-react";
import AppShell from "@/components/AppShell";
import CampaignSettings from "@/components/newsletter/CampaignSettings";
import PersonalizedCampaignPanel from "@/components/newsletter/PersonalizedCampaignPanel";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";

const STATUS_LABELS = {
  draft: "Concept",
  tested: "Getest",
  syncing: "Bezig met verzenden",
  sent: "Verzonden",
  failed: "Mislukt",
};

function statusClass(status) {
  if (status === "sent") return "bg-green-50 text-green-700 border-green-100";
  if (status === "tested") return "bg-blue-50 text-blue-700 border-blue-100";
  if (status === "failed") return "bg-red-50 text-red-600 border-red-100";
  return "bg-gray-50 text-gray-600 border-gray-100";
}

// Eén gepersonaliseerde nieuwsbrief: instellingen bovenaan, daaronder de
// stappen inhoud, personalisatie en voorbeeld/verzenden.
export default function NieuwsbriefCampagnePage() {
  const { id } = useParams();
  const { organization, user } = useOrg();
  const [campaign, setCampaign] = useState(null);
  const [targetNames, setTargetNames] = useState([]);
  const [resendReady, setResendReady] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || "");
  const [error, setError] = useState("");
  // Na opslaan van de instellingen: personalisatie en voorbeeld opnieuw laden.
  const [refreshKey, setRefreshKey] = useState(0);
  const accent = organization?.theme?.accent || "#F5A623";

  useEffect(() => {
    if (user?.email && !testEmail) setTestEmail(user.email);
  }, [user, testEmail]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [campaignRes, settingsRes, segmentsRes] = await Promise.all([
        apiFetch(`/api/newsletter/campaigns/${id}`),
        apiFetch("/api/newsletter/settings"),
        apiFetch("/api/newsletter/segments"),
      ]);
      const [campaignJson, settingsJson, segmentsJson] = await Promise.all([
        campaignRes.json(),
        settingsRes.json(),
        segmentsRes.json(),
      ]);
      if (!campaignRes.ok) throw new Error(campaignJson.error || "Campagne laden mislukt");
      const loaded = campaignJson.campaign;
      if (loaded.mode !== "personalized") throw new Error("Deze pagina is voor gepersonaliseerde nieuwsbrieven");
      setCampaign(loaded);
      const s = settingsJson.settings;
      setResendReady(Boolean(s?.has_api_key && s.api_key_valid !== false && s.from_name && s.from_email && s.reply_to));
      const ids = loaded.included_segment_ids?.length ? loaded.included_segment_ids : [loaded.segment_id].filter(Boolean);
      const byId = new Map((segmentsJson.segments || []).map((segment) => [segment.id, segment.name]));
      setTargetNames(ids.map((segmentId) => byId.get(segmentId)).filter(Boolean));
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AppShell>
      <div className="space-y-4">
        <Link href="/admin/nieuwsbrieven" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black">
          <ArrowLeft className="w-4 h-4" />
          Alle nieuwsbrieven
        </Link>

        {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}

        {!campaign && !error && (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        )}

        {campaign && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold text-brand-black">{campaign.name}</h1>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${statusClass(campaign.status)}`}>
                    {STATUS_LABELS[campaign.status] || campaign.status}
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                  <Sparkles className="w-3.5 h-3.5 text-brand-orange" />
                  Gepersonaliseerd per bedrijf · {campaign.subject}
                </p>
              </div>
              {campaign.test_sent_at && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                  <CheckCircle className="w-4 h-4" />
                  Test verstuurd
                </span>
              )}
            </div>

            <CampaignSettings
              campaign={campaign}
              targetNames={targetNames}
              onSaved={(saved) => {
                setCampaign(saved);
                setRefreshKey((key) => key + 1);
              }}
            />

            <div className="bg-white border border-gray-100 rounded-card p-5">
              <PersonalizedCampaignPanel
                campaign={campaign}
                refreshKey={refreshKey}
                resendReady={resendReady}
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                accent={accent}
                onCampaignChange={setCampaign}
              />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
