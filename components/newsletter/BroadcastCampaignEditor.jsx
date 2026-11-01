"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Save, Send, Users } from "lucide-react";
import AudienceFields from "@/components/newsletter/AudienceFields";
import CampaignActionBar, { actionButtonClass } from "@/components/newsletter/CampaignActionBar";
import CampaignResults from "@/components/newsletter/CampaignResults";
import { BatchFields, HtmlEditor, ScheduleField } from "@/components/newsletter/BroadcastFields";
import { apiFetch } from "@/lib/api";
import { campaignTargetIds, sameIdList } from "@/lib/newsletter-audience";
import {
  canMutateCampaign,
  canSendCampaign,
  formatDateTime,
  hasSendStarted,
  isFutureDateTime,
  scheduledAtLabel,
  sendActionLabel,
  sendActionTitle,
} from "@/lib/newsletter-status";
import { confirmDialog } from "@/components/Dialogs";

const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber disabled:bg-gray-50";

const FORM_FIELDS = [
  "name", "subject", "preview_text", "segment_id", "included_segment_ids", "excluded_segment_ids",
  "recipient_limit", "batch_mode", "batch_size", "batch_wait_hours", "max_bounce_rate",
  "max_complaint_rate", "max_failed_rate", "max_unsubscribe_rate", "scheduled_at", "body_html",
];

function formFromCampaign(campaign) {
  const targetIds = campaignTargetIds(campaign);
  return {
    name: campaign.name || "",
    subject: campaign.subject || "",
    preview_text: campaign.preview_text || "",
    segment_id: targetIds[0] || "",
    included_segment_ids: targetIds,
    excluded_segment_ids: campaign.excluded_segment_ids || [],
    recipient_limit: campaign.recipient_limit || "",
    batch_mode: campaign.batch_mode || "single",
    batch_size: campaign.batch_size || "",
    batch_wait_hours: campaign.batch_wait_hours || "4",
    max_bounce_rate: campaign.max_bounce_rate ?? "0.02",
    max_complaint_rate: campaign.max_complaint_rate ?? "0",
    max_failed_rate: campaign.max_failed_rate ?? "0.03",
    max_unsubscribe_rate: campaign.max_unsubscribe_rate ?? "0.05",
    scheduled_at: campaign.scheduled_at || "",
    body_html: campaign.body_html || "",
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

// Wijzigingen waarna de testmail opnieuw moet (zelfde regels als voorheen).
function formNeedsRetest(campaign, form) {
  return (
    normalizeText(campaign.subject) !== normalizeText(form.subject) ||
    normalizeText(campaign.preview_text) !== normalizeText(form.preview_text) ||
    normalizeText(campaign.body_html) !== normalizeText(form.body_html) ||
    !sameIdList(campaignTargetIds(campaign), campaignTargetIds(form)) ||
    Number(campaign.recipient_limit || 0) !== Number(form.recipient_limit || 0) ||
    String(campaign.batch_mode || "single") !== String(form.batch_mode || "single") ||
    Number(campaign.batch_size || 0) !== Number(form.batch_size || 0) ||
    Number(campaign.batch_wait_hours || 0) !== Number(form.batch_wait_hours || 0) ||
    !sameIdList(campaign.excluded_segment_ids, form.excluded_segment_ids)
  );
}

// Vergelijkbare vorm van het formulier: tijd als moment en getallen als getal,
// zodat dezelfde waarde opnieuw kiezen of typen geen wijziging is.
const NUMBER_FIELDS = new Set([
  "recipient_limit", "batch_size", "batch_wait_hours", "max_bounce_rate",
  "max_complaint_rate", "max_failed_rate", "max_unsubscribe_rate",
]);

function comparableForm(form) {
  return JSON.stringify(Object.fromEntries(FORM_FIELDS.map((field) => {
    const value = form[field];
    if (field === "scheduled_at") return [field, value ? new Date(value).getTime() : null];
    if (NUMBER_FIELDS.has(field)) return [field, value === "" || value == null ? null : Number(value)];
    if (Array.isArray(value)) return [field, [...value].sort()];
    return [field, value];
  })));
}

function payloadFromForm(form) {
  return Object.fromEntries(FORM_FIELDS.map((field) => [field, form[field]]));
}

// Een standaardcampagne (eigen HTML) bewerken, testen en verzenden. Na
// verzenden of tijdens het verzenden is alles alleen-lezen.
export default function BroadcastCampaignEditor({
  campaign,
  segments,
  resendReady,
  testEmail,
  setTestEmail,
  accent,
  onCampaignChange,
  onShowRecipients,
}) {
  const [form, setForm] = useState(() => formFromCampaign(campaign));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const editable = canMutateCampaign(campaign);
  const savedForm = formFromCampaign(campaign);
  const dirty = comparableForm(savedForm) !== comparableForm(form);
  const targetIds = campaignTargetIds(form);
  const needsRetest = formNeedsRetest(campaign, form);
  const canSaveAndPlan = Boolean(
    campaign.test_sent_at &&
    targetIds.length &&
    isFutureDateTime(form.scheduled_at) &&
    !needsRetest &&
    resendReady
  );

  // Na opslaan, testen of verzenden komt er een nieuwe campagne binnen.
  const persistedKey = JSON.stringify(savedForm);
  useEffect(() => {
    setForm(JSON.parse(persistedKey));
  }, [persistedKey]);

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(""), 2500);
  }

  async function save() {
    const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadFromForm(form)),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Campagne wijzigen mislukt");
    onCampaignChange(json.campaign);
    return json.campaign;
  }

  async function sendTest(target) {
    const res = await apiFetch(`/api/newsletter/campaigns/${target.id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: testEmail }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Testmail mislukt");
    onCampaignChange(json.campaign);
  }

  async function sendCampaign(target) {
    const scheduled = isFutureDateTime(target.scheduled_at);
    const action = scheduled ? `plannen voor ${formatDateTime(target.scheduled_at)}` : "definitief verzenden";
    if (!(await confirmDialog({
      title: `Campagne "${target.name}" ${action}?`,
      message: scheduled ? "De campagne gaat op het geplande moment automatisch de deur uit." : "De campagne gaat nu naar alle ontvangers. Dit kan niet worden teruggedraaid.",
      confirmLabel: scheduled ? "Plannen" : "Definitief verzenden",
    }))) return false;
    const res = await apiFetch(`/api/newsletter/campaigns/${target.id}/send`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Verzenden mislukt");
    onCampaignChange(json.campaign);
    flash(json.campaign?.status === "scheduled" ? "Campagne gepland" : "Campagne verzonden");
    return true;
  }

  async function run(key, task) {
    setBusy(key);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const onSave = () => run("save", async () => {
    await save();
    flash("Campagne bijgewerkt");
  });

  // Testmail gaat altijd over de opgeslagen versie: bij wijzigingen eerst opslaan.
  const onTest = () => {
    if (!testEmail) {
      setError("Vul eerst een testmailadres in");
      return;
    }
    run("test", async () => {
      const target = dirty ? await save() : campaign;
      await sendTest(target);
      flash("Testmail verzonden");
    });
  };

  const onSend = () => run("send", () => sendCampaign(campaign));

  const onSaveAndPlan = () => run("send", async () => {
    const saved = await save();
    await sendCampaign(saved);
  });

  return (
    <div className="space-y-4">
      <CampaignActionBar>
        {editable && (
          <>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Testmail naar"
              className={`flex-1 ${inputClass}`}
            />
            <button
              type="button"
              onClick={onTest}
              disabled={!resendReady || !testEmail || !targetIds.length || Boolean(busy)}
              className={actionButtonClass}
              title={!resendReady ? "Resend API-key opnieuw opslaan" : dirty ? "Wijzigingen opslaan en testmail versturen" : "Testmail versturen"}
            >
              {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {dirty ? "Opslaan en testmail" : "Testmail"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onShowRecipients(campaign)}
          className={actionButtonClass}
        >
          <Users className="w-4 h-4" />
          Ontvangers
        </button>
        {editable && (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSendCampaign(campaign) || dirty || Boolean(busy)}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: accent }}
            title={dirty ? "Sla eerst je wijzigingen op" : sendActionTitle(campaign)}
          >
            {busy === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sendActionLabel(campaign)}
          </button>
        )}
      </CampaignActionBar>

      {error && <div className="px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {message && <div className="px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">{message}</div>}

      {hasSendStarted(campaign) ? (
        <CampaignResults campaign={campaign} />
      ) : !editable && (
        <div className="bg-white border border-gray-100 rounded-card p-4 text-sm text-gray-600 space-y-1">
          <p className="font-semibold text-brand-black">Deze campagne is ingepland en niet meer te wijzigen.</p>
          {campaign.scheduled_at && <p>{scheduledAtLabel(campaign)}: {formatDateTime(campaign.scheduled_at)}</p>}
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-card p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-5 items-start">
          <div className="space-y-3">
            <input
              value={form.name}
              disabled={!editable}
              onChange={(e) => { const value = e.target.value; setForm((current) => ({ ...current, name: value })); }}
              placeholder="Interne campagnenaam"
              className={inputClass}
            />
            <input
              value={form.subject}
              disabled={!editable}
              onChange={(e) => { const value = e.target.value; setForm((current) => ({ ...current, subject: value })); }}
              placeholder="Titel / onderwerp"
              className={inputClass}
            />
            <input
              value={form.preview_text}
              disabled={!editable}
              onChange={(e) => { const value = e.target.value; setForm((current) => ({ ...current, preview_text: value })); }}
              placeholder="Previewtekst"
              className={inputClass}
            />
            <ScheduleField form={form} setForm={setForm} disabled={!editable}>
              {editable && (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={onSave}
                      disabled={Boolean(busy) || !targetIds.length}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-pill text-xs font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-60"
                    >
                      <Save className="w-4 h-4" />
                      Tijd opslaan
                    </button>
                    <button
                      type="button"
                      onClick={onSaveAndPlan}
                      disabled={Boolean(busy) || !canSaveAndPlan}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-pill text-xs font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: accent }}
                      title={
                        canSaveAndPlan
                          ? "Tijd opslaan en daarna definitief plannen"
                          : needsRetest
                            ? "Na inhoud of doelgroep wijzigen eerst opnieuw testmail sturen"
                            : "Kies een toekomstige tijd en stuur eerst een testmail"
                      }
                    >
                      <Send className="w-4 h-4" />
                      Opslaan en plannen
                    </button>
                  </div>
                  {needsRetest && campaign.test_sent_at && (
                    <p className="text-xs text-brand-orange">
                      Inhoud of doelgroep is gewijzigd. Stuur na opslaan opnieuw een testmail voordat je kunt plannen.
                    </p>
                  )}
                </>
              )}
            </ScheduleField>
            <AudienceFields segments={segments} form={form} setForm={setForm} disabled={!editable} />
            <BatchFields form={form} setForm={setForm} disabled={!editable} />
          </div>
          <div className="space-y-3">
            <HtmlEditor
              value={form.body_html}
              disabled={!editable}
              onChange={(value) => setForm((current) => ({ ...current, body_html: value }))}
            />
            {editable && (
              <button
                type="button"
                onClick={onSave}
                disabled={Boolean(busy) || !dirty || !targetIds.length}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: accent }}
              >
                {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Wijzigingen opslaan
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
