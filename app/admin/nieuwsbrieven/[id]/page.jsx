"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle, Code2, Loader2, Send, Sparkles, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import BroadcastCampaignEditor from "@/components/newsletter/BroadcastCampaignEditor";
import CampaignActionBar, { actionButtonClass } from "@/components/newsletter/CampaignActionBar";
import CampaignResults from "@/components/newsletter/CampaignResults";
import CampaignSettings from "@/components/newsletter/CampaignSettings";
import PersonalizedCampaignPanel from "@/components/newsletter/PersonalizedCampaignPanel";
import RecipientsDrawer from "@/components/newsletter/RecipientsDrawer";
import { apiFetch } from "@/lib/api";
import { campaignTargetIds } from "@/lib/newsletter-audience";
import { canMutateCampaign, hasSendStarted, statusClass, statusLabel } from "@/lib/newsletter-status";
import { useOrg } from "@/lib/org-context";
import { campaignSubjectLabel } from "@/lib/newsletter-subject";

// Eén nieuwsbrief. Gepersonaliseerd: instellingen bovenaan, daaronder de
// stappen inhoud, personalisatie, voorbeeld/verzenden en social posts.
// Standaard: het formulier met HTML, testmail en verzenden.
export default function NieuwsbriefCampagnePage() {
  const { id } = useParams();
  const { organization, user } = useOrg();
  const [campaign, setCampaign] = useState(null);
  const [segments, setSegments] = useState([]);
  const [resendReady, setResendReady] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email || "");
  const [recipientsCampaign, setRecipientsCampaign] = useState(null);
  const [error, setError] = useState("");
  // Na opslaan van de instellingen: personalisatie en voorbeeld opnieuw laden.
  const [refreshKey, setRefreshKey] = useState(0);
  // Stap van de gepersonaliseerde werkruimte; de actiebalk springt naar stap 3.
  const [personalizedTab, setPersonalizedTab] = useState("content");
  const [progress, setProgress] = useState(null);
  const panelRef = useRef(null);
  const [panelJump, setPanelJump] = useState(0);
  const accent = organization?.theme?.accent || "#F5A623";
  const closeRecipients = useCallback(() => setRecipientsCampaign(null), []);

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
      setCampaign(campaignJson.campaign);
      const s = settingsJson.settings;
      setResendReady(Boolean(s?.has_api_key && s.api_key_valid !== false && s.from_name && s.from_email && s.reply_to));
      setSegments(segmentsJson.segments || []);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Na "Naar testmail en verzenden": direct (niet smooth) naar de werkruimte
  // scrollen, want de voorbeeldstap laadt en verandert de paginahoogte.
  useEffect(() => {
    if (panelJump) panelRef.current?.scrollIntoView({ block: "start" });
  }, [panelJump]);

  const personalized = campaign?.mode === "personalized";
  const targetNames = campaign
    ? campaignTargetIds(campaign).map((segmentId) => segments.find((segment) => segment.id === segmentId)?.name).filter(Boolean)
    : [];

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
                    {statusLabel(campaign.status)}
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                  {personalized ? (
                    <Sparkles className="w-3.5 h-3.5 text-brand-orange" />
                  ) : (
                    <Code2 className="w-3.5 h-3.5 text-gray-400" />
                  )}
                  {personalized ? "Gepersonaliseerd per bedrijf" : "Standaard (eigen HTML)"} · {campaignSubjectLabel(campaign)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {campaign.test_sent_at && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                    <CheckCircle className="w-4 h-4" />
                    Test verstuurd
                  </span>
                )}
              </div>
            </div>

            {personalized ? (
              <>
                <CampaignActionBar>
                  <p className="flex-1 text-sm text-gray-600">
                    {campaign.status === "sent"
                      ? "Verzonden. Het resultaat staat hieronder."
                      : hasSendStarted(campaign)
                        ? "Bezig met verzenden. Het resultaat vult zich hieronder."
                        : progress
                          ? `${progress.approved}/${progress.total} bedrijven goedgekeurd${campaign.test_sent_at ? " · testmail verstuurd" : ""}`
                          : "Gepersonaliseerd per bedrijf"}
                  </p>
                  <button type="button" onClick={() => setRecipientsCampaign(campaign)} className={actionButtonClass}>
                    <Users className="w-4 h-4" />
                    Ontvangers
                  </button>
                  {canMutateCampaign(campaign) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPersonalizedTab("preview");
                        setPanelJump((count) => count + 1);
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white"
                      style={{ backgroundColor: accent }}
                    >
                      <Send className="w-4 h-4" />
                      Naar testmail en verzenden
                    </button>
                  )}
                </CampaignActionBar>

                {hasSendStarted(campaign) && <CampaignResults campaign={campaign} />}

                <CampaignSettings
                  campaign={campaign}
                  targetNames={targetNames}
                  onSaved={(saved) => {
                    setCampaign(saved);
                    setRefreshKey((key) => key + 1);
                  }}
                />

                <div ref={panelRef} className="bg-white border border-gray-100 rounded-card p-5 scroll-mt-24">
                  <PersonalizedCampaignPanel
                    campaign={campaign}
                    refreshKey={refreshKey}
                    resendReady={resendReady}
                    testEmail={testEmail}
                    setTestEmail={setTestEmail}
                    accent={accent}
                    onCampaignChange={setCampaign}
                    tab={personalizedTab}
                    onTabChange={setPersonalizedTab}
                    onProgress={setProgress}
                  />
                </div>
              </>
            ) : (
              <BroadcastCampaignEditor
                campaign={campaign}
                segments={segments}
                resendReady={resendReady}
                testEmail={testEmail}
                setTestEmail={setTestEmail}
                accent={accent}
                onCampaignChange={setCampaign}
                onShowRecipients={setRecipientsCampaign}
              />
            )}
          </>
        )}
      </div>
      <RecipientsDrawer campaign={recipientsCampaign} onClose={closeRecipients} />
    </AppShell>
  );
}
