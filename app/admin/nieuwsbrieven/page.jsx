"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle,
  Edit3,
  Loader2,
  Mail,
  Megaphone,
  Plus,
  Save,
  Send,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

const SOURCE_TYPES = [
  { id: "all_marketing", label: "Alle marketingcontacten" },
  { id: "marketing_segment", label: "Marketingsegment bevat" },
  { id: "without_marketing_segments", label: "Zonder marketingsegmenten" },
  { id: "lead_status", label: "Leadstatus is" },
  { id: "relationship_type", label: "Relatietype is" },
  { id: "hubspot_deal_origin", label: "HubSpot-herkomst is" },
  { id: "industry", label: "Branche is" },
  { id: "recipient_email_in", label: "Exacte ontvanger e-mails" },
  { id: "recipient_email_contains", label: "Ontvanger e-mail bevat" },
  { id: "recent_order_days", label: "Recent besteld binnen dagen" },
];

const STATUS_LABELS = {
  draft: "Concept",
  tested: "Getest",
  approved: "Goedgekeurd",
  syncing: "Synchroniseren",
  scheduled: "Gepland",
  sent: "Verzonden",
  failed: "Mislukt",
  batch_waiting: "Batch wacht",
  paused: "Gepauzeerd",
};
const MAX_RECIPIENT_LIMIT = 100000;

function statusClass(status) {
  if (status === "sent") return "bg-green-50 text-green-700 border-green-100";
  if (status === "tested") return "bg-blue-50 text-blue-700 border-blue-100";
  if (status === "syncing" || status === "scheduled" || status === "batch_waiting") return "bg-amber-50 text-brand-orange border-amber-100";
  if (status === "failed" || status === "paused") return "bg-red-50 text-red-600 border-red-100";
  return "bg-gray-50 text-gray-600 border-gray-100";
}

function normalizeIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
}

function campaignTargetIds(campaign) {
  const ids = normalizeIds(campaign?.included_segment_ids || []);
  if (ids.length) return ids;
  return campaign?.segment_id ? [campaign.segment_id] : [];
}

function emptyCampaign(includedSegmentIds = [], excludedSegmentIds = []) {
  const targets = normalizeIds(includedSegmentIds);
  return {
    name: "",
    subject: "",
    preview_text: "",
    segment_id: targets[0] || "",
    included_segment_ids: targets,
    excluded_segment_ids: excludedSegmentIds,
    recipient_limit: "",
    batch_mode: "automatic",
    batch_size: "100",
    batch_wait_hours: "4",
    max_bounce_rate: "0.02",
    max_complaint_rate: "0",
    max_failed_rate: "0.03",
    max_unsubscribe_rate: "0.05",
    scheduled_at: "",
    body_html: "",
  };
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isFutureDateTime(value) {
  return Boolean(value) && new Date(value).getTime() > Date.now();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function sameIdList(a, b) {
  const left = [...new Set((Array.isArray(a) ? a : []).filter(Boolean))].sort();
  const right = [...new Set((Array.isArray(b) ? b : []).filter(Boolean))].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sameSegmentRule(a, b) {
  if (!a || !b) return false;
  return (
    a.source_type === b.source_type &&
    String(a.source_value || "").trim().toLowerCase() === String(b.source_value || "").trim().toLowerCase()
  );
}

function segmentCanExclude(segment, includeSegments = []) {
  if (!segment || segment.source_type === "all_marketing") return false;
  if (includeSegments.some((includeSegment) => segment.id === includeSegment.id || sameSegmentRule(segment, includeSegment))) return false;
  if (includeSegments.some((includeSegment) => includeSegment.source_type === "recipient_email_contains") && !segment.default_excluded) {
    return segment.source_type === "recipient_email_contains";
  }
  return true;
}

export default function NieuwsbrievenPage() {
  const router = useRouter();
  const { organization, user } = useOrg();
  const [settings, setSettings] = useState(null);
  const [segments, setSegments] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [segmentOptions, setSegmentOptions] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [selected, setSelected] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    from_name: "",
    from_email: "",
    reply_to: "",
    resend_api_key: "",
    resend_webhook_secret: "",
  });
  const [segmentForm, setSegmentForm] = useState({ name: "", source_type: "all_marketing", source_value: "" });
  const [campaignForm, setCampaignForm] = useState(emptyCampaign());
  const [editingCampaignId, setEditingCampaignId] = useState("");
  const [activeSection, setActiveSection] = useState("campaigns");
  const [editorMode, setEditorMode] = useState("html");
  const [testEmail, setTestEmail] = useState(user?.email || "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const accent = organization?.theme?.accent || "#F5A623";
  const resendReady = Boolean(
    settings?.has_api_key &&
    settings.api_key_valid !== false &&
    settings?.from_name &&
    settings?.from_email &&
    settings?.reply_to
  );
  const targetSegmentIds = useMemo(
    () => campaignTargetIds(campaignForm),
    [campaignForm]
  );
  const selectedTargetSegments = useMemo(
    () => targetSegmentIds.map((id) => segments.find((segment) => segment.id === id)).filter(Boolean),
    [segments, targetSegmentIds]
  );
  const defaultExcludedSegmentIds = useMemo(
    () => segments.filter((segment) => segment.default_excluded).map((segment) => segment.id),
    [segments]
  );
  const campaignExcludedIds = useMemo(
    () => new Set([...(campaignForm.excluded_segment_ids || []), ...defaultExcludedSegmentIds]),
    [campaignForm.excluded_segment_ids, defaultExcludedSegmentIds]
  );
  const availableExclusionSegments = useMemo(
    () => segments.filter((segment) => segmentCanExclude(segment, selectedTargetSegments)),
    [segments, selectedTargetSegments]
  );
  const availableTargetSegments = useMemo(
    () => segments.filter((segment) => !segment.default_excluded),
    [segments]
  );
  const availableSourceValues = segmentOptions?.options?.[segmentForm.source_type] || [];

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.email && !testEmail) setTestEmail(user.email);
  }, [user, testEmail]);

  async function fetchAll() {
    setLoading(true);
    setError("");
    try {
      const [settingsRes, segmentsRes, campaignsRes] = await Promise.all([
        apiFetch("/api/newsletter/settings"),
        apiFetch("/api/newsletter/segments"),
        apiFetch("/api/newsletter/campaigns"),
      ]);
      const [settingsJson, segmentsJson, campaignsJson] = await Promise.all([
        settingsRes.json(),
        segmentsRes.json(),
        campaignsRes.json(),
      ]);
      if (!settingsRes.ok) throw new Error(settingsJson.error || "Kon instellingen niet laden");
      if (!segmentsRes.ok) throw new Error(segmentsJson.error || "Kon segmenten niet laden");
      if (!campaignsRes.ok) throw new Error(campaignsJson.error || "Kon campagnes niet laden");

      const optionsRes = await apiFetch("/api/newsletter/segment-options");
      const optionsJson = await optionsRes.json();
      if (optionsRes.ok) setSegmentOptions(optionsJson);

      setSetupRequired(false);
      setSettings(settingsJson.settings);
      setSegments(segmentsJson.segments || []);
      setCampaigns(campaignsJson.campaigns || []);
      setSettingsForm({
        from_name: settingsJson.settings?.from_name || organization?.display_name || "",
        from_email: settingsJson.settings?.from_email || "",
        reply_to: settingsJson.settings?.reply_to || settingsJson.settings?.from_email || "",
        resend_api_key: "",
        resend_webhook_secret: "",
      });
      const defaultTarget = (segmentsJson.segments || []).find((segment) => !segment.default_excluded) || segmentsJson.segments?.[0];
      if (!campaignTargetIds(campaignForm).length && defaultTarget) {
        setCampaignForm((current) => ({
          ...current,
          segment_id: defaultTarget.id,
          included_segment_ids: [defaultTarget.id],
        }));
      }
    } catch (err) {
      setError(err.message);
      setSetupRequired(/migrations\/016_multi_tenant_newsletters\.sql|Nieuwsbrief-tabellen ontbreken/i.test(err.message));
    } finally {
      setLoading(false);
    }
  }

  function flash(text) {
    setMessage(text);
    setTimeout(() => setMessage(""), 2500);
  }

  function toggleExcludedSegment(segmentId) {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segmentCanExclude(segment, selectedTargetSegments)) return;
    const current = new Set(campaignForm.excluded_segment_ids || []);
    if (current.has(segmentId)) current.delete(segmentId);
    else current.add(segmentId);
    setCampaignForm({ ...campaignForm, excluded_segment_ids: [...current] });
  }

  function toggleTargetSegment(segmentId) {
    setCampaignForm((current) => {
      const currentTargets = new Set(campaignTargetIds(current));
      if (currentTargets.has(segmentId)) {
        if (currentTargets.size === 1) return current;
        currentTargets.delete(segmentId);
      } else {
        currentTargets.add(segmentId);
      }
      const targets = [...currentTargets];
      return {
        ...current,
        segment_id: targets[0] || "",
        included_segment_ids: targets,
        excluded_segment_ids: (current.excluded_segment_ids || []).filter((id) => id !== segmentId),
      };
    });
  }

  function excludedSegmentNames(campaign) {
    const ids = new Set([...(campaign.excluded_segment_ids || []), ...defaultExcludedSegmentIds]);
    const includeSegments = campaignTargetIds(campaign).map((id) => segments.find((item) => item.id === id)).filter(Boolean);
    return segments
      .filter((segment) => ids.has(segment.id))
      .filter((segment) => segmentCanExclude(segment, includeSegments))
      .map((segment) => segment.name);
  }

  function targetSegmentNames(campaign) {
    const ids = campaignTargetIds(campaign);
    if (!ids.length) return ["Alle marketingcontacten"];
    return ids
      .map((id) => segments.find((segment) => segment.id === id)?.name)
      .filter(Boolean);
  }

  function canMutateCampaign(campaign) {
    return ["draft", "tested", "failed"].includes(campaign.status);
  }

  function canSendCampaign(campaign) {
    return Boolean(campaign.test_sent_at) && !["sent", "scheduled", "syncing", "batch_waiting", "paused"].includes(campaign.status) && !hasExpiredSchedule(campaign);
  }

  function formNeedsRetest(campaign, form) {
    if (!campaign) return false;
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

  function canSaveAndPlanFromForm() {
    return Boolean(
      editingCampaignId &&
      selected?.id === editingCampaignId &&
      selected?.test_sent_at &&
      targetSegmentIds.length &&
      isFutureDateTime(campaignForm.scheduled_at) &&
      !formNeedsRetest(selected, campaignForm) &&
      resendReady
    );
  }

  function hasExpiredSchedule(campaign) {
    return Boolean(campaign.scheduled_at) && !isFutureDateTime(campaign.scheduled_at) && !["sent", "scheduled"].includes(campaign.status);
  }

  function sendActionLabel(campaign) {
    if (hasExpiredSchedule(campaign)) return "Tijd verlopen";
    if (campaign.batch_mode === "automatic") return "Start batches";
    return isFutureDateTime(campaign.scheduled_at) ? "Plannen" : "Verzenden";
  }

  function sendActionTitle(campaign) {
    if (!campaign.test_sent_at) return "Eerst testmail sturen";
    if (hasExpiredSchedule(campaign)) return "Kies eerst een nieuwe toekomstige verzendtijd";
    if (campaign.batch_mode === "automatic") return "Automatische batchverzending starten";
    return isFutureDateTime(campaign.scheduled_at) ? "Definitief plannen" : "Definitief verzenden";
  }

  function scheduledAtLabel(campaign) {
    if (campaign.status === "scheduled") return "Gepland";
    if (isFutureDateTime(campaign.scheduled_at)) return "Verzendtijd";
    return "Verzendtijd verstreken";
  }

  function startEditCampaign(campaign) {
    if (!canMutateCampaign(campaign)) return;
    const targetIds = campaignTargetIds(campaign);
    setEditingCampaignId(campaign.id);
    setCampaignForm({
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
    });
    setEditorMode("html");
    setActiveSection("campaigns");
    setSelected(campaign);
    setRecipients(null);
  }

  function cancelEditCampaign() {
    const fallbackTargetIds = campaignTargetIds(campaignForm);
    setEditingCampaignId("");
    setCampaignForm(emptyCampaign(fallbackTargetIds, []));
  }

  async function saveSettings(e) {
    e.preventDefault();
    setBusy("settings");
    setError("");
    try {
      const payload = { ...settingsForm };
      if (!payload.resend_api_key) delete payload.resend_api_key;
      if (!payload.resend_webhook_secret) delete payload.resend_webhook_secret;
      const res = await apiFetch("/api/newsletter/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setSettings(json.settings);
      setSettingsForm((current) => ({ ...current, resend_api_key: "", resend_webhook_secret: "" }));
      flash("Instellingen opgeslagen");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function createSegment(e) {
    e.preventDefault();
    setBusy("segment");
    setError("");
    try {
      const res = await apiFetch("/api/newsletter/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(segmentForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Segment opslaan mislukt");
      setSegments((current) => [...current, json.segment]);
      setSegmentForm({ name: "", source_type: "all_marketing", source_value: "" });
      flash("Segment toegevoegd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteSegment(segment) {
    if (segment.default_excluded) return;
    if (!confirm(`Segment "${segment.name}" verwijderen?`)) return;
    setBusy(`delete-segment-${segment.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/segments?id=${encodeURIComponent(segment.id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Segment verwijderen mislukt");
      setSegments((current) => current.filter((item) => item.id !== segment.id));
      setCampaigns((current) => current.map((campaign) => (
        canMutateCampaign(campaign)
          ? {
              ...campaign,
              status: "draft",
              test_sent_at: null,
              included_segment_ids: campaignTargetIds(campaign).filter((id) => id !== segment.id),
              segment_id: campaignTargetIds(campaign).filter((id) => id !== segment.id)[0] || null,
              excluded_segment_ids: (campaign.excluded_segment_ids || []).filter((id) => id !== segment.id),
              newsletter_segments: campaign.segment_id === segment.id ? null : campaign.newsletter_segments,
            }
          : campaign
      )));
      setCampaignForm((current) => ({
        ...current,
        included_segment_ids: campaignTargetIds(current).filter((id) => id !== segment.id),
        segment_id: campaignTargetIds(current).filter((id) => id !== segment.id)[0] || "",
        excluded_segment_ids: (current.excluded_segment_ids || []).filter((id) => id !== segment.id),
      }));
      if (selected && canMutateCampaign(selected)) {
        setSelected((current) => current ? {
          ...current,
          status: "draft",
          test_sent_at: null,
          included_segment_ids: campaignTargetIds(current).filter((id) => id !== segment.id),
          segment_id: campaignTargetIds(current).filter((id) => id !== segment.id)[0] || null,
          excluded_segment_ids: (current.excluded_segment_ids || []).filter((id) => id !== segment.id),
          newsletter_segments: current.segment_id === segment.id ? null : current.newsletter_segments,
        } : current);
      }
      flash("Segment verwijderd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function createCampaign(e) {
    e.preventDefault();
    return saveCampaign({ testAfterSave: false });
  }

  async function saveCampaign({ testAfterSave = false, sendAfterSave = false } = {}) {
    setBusy("campaign");
    setError("");
    try {
      const isEditing = Boolean(editingCampaignId);
      const res = await apiFetch(
        isEditing ? `/api/newsletter/campaigns/${editingCampaignId}` : "/api/newsletter/campaigns",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaignForm),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || (isEditing ? "Campagne wijzigen mislukt" : "Campagne opslaan mislukt"));
      setCampaigns((current) => (
        isEditing
          ? current.map((item) => (item.id === json.campaign.id ? json.campaign : item))
          : [json.campaign, ...current]
      ));
      setSelected(json.campaign);
      setEditingCampaignId("");
      setCampaignForm(emptyCampaign(campaignTargetIds(campaignForm), campaignForm.excluded_segment_ids));
      setRecipients(null);
      if (testAfterSave) {
        await sendTest(json.campaign);
        return;
      }
      if (sendAfterSave) {
        await sendCampaign(json.campaign);
        return;
      }
      flash(isEditing ? "Campagne bijgewerkt" : "Campagne aangemaakt");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function deleteCampaign(campaign) {
    if (!canMutateCampaign(campaign)) return;
    if (!confirm(`Campagne "${campaign.name}" verwijderen?`)) return;
    setBusy(`delete-campaign-${campaign.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Campagne verwijderen mislukt");
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      if (selected?.id === campaign.id) {
        setSelected(null);
        setRecipients(null);
      }
      if (editingCampaignId === campaign.id) {
        setEditingCampaignId("");
        setCampaignForm(emptyCampaign(campaignTargetIds(campaignForm), campaignForm.excluded_segment_ids));
      }
      flash("Campagne verwijderd");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function previewRecipients(campaign) {
    setBusy(`preview-${campaign.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}/recipients`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Preview mislukt");
      setSelected(campaign);
      setRecipients(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function sendTest(campaign) {
    if (!resendReady) {
      setActiveSection("resend");
      setError("Sla eerst de Resend API-key opnieuw op bij Resend instellingen.");
      return;
    }
    if (!testEmail) {
      setError("Vul eerst een testmailadres in");
      return;
    }
    setBusy(`test-${campaign.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Testmail mislukt");
      setCampaigns((current) => current.map((item) => (item.id === campaign.id ? json.campaign : item)));
      setSelected(json.campaign);
      flash("Testmail verzonden");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function sendCampaign(campaign) {
    const scheduled = isFutureDateTime(campaign.scheduled_at);
    const action = scheduled ? `plannen voor ${formatDateTime(campaign.scheduled_at)}` : "definitief verzenden";
    if (!confirm(`Campagne "${campaign.name}" ${action}?`)) return;
    setBusy(`send-${campaign.id}`);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaign.id}/send`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verzenden mislukt");
      setCampaigns((current) => current.map((item) => (item.id === campaign.id ? json.campaign : item)));
      setSelected(json.campaign);
      setRecipients(null);
      flash(json.campaign?.status === "scheduled" ? "Campagne gepland" : "Campagne verzonden");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Terug
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Nieuwsbrieven</h1>
          <p className="text-sm text-gray-500 mt-0.5">{organization?.display_name}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Megaphone className="w-4 h-4" />
          {campaigns.length} campagnes
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {setupRequired && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 text-brand-orange text-sm">
          De nieuwsbriefmodule is nog niet klaar in de database. Draai eerst de SQL-migratie en herlaad daarna deze pagina.
        </div>
      )}
      {settings?.api_key_valid === false && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 text-brand-orange text-sm flex items-center justify-between gap-3">
          <span>De opgeslagen Resend API-key kan niet worden gelezen. Plak de API-key opnieuw bij Resend instellingen en sla op.</span>
          <button
            type="button"
            onClick={() => setActiveSection("resend")}
            className="shrink-0 px-3 py-1.5 rounded-pill bg-white border border-amber-200 font-semibold"
          >
            Instellingen openen
          </button>
        </div>
      )}
      {message && <div className="mb-4 px-4 py-3 rounded-xl bg-green-50 text-green-700 text-sm">{message}</div>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-white p-1">
            {[
              { id: "campaigns", label: "Campagnes" },
              { id: "resend", label: "Resend" },
              { id: "segments", label: "Segmenten" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeSection === item.id
                    ? "bg-amber-50 text-brand-orange"
                    : "text-gray-500 hover:text-brand-black"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
          <div className="space-y-6">
            {activeSection === "resend" && (
            <form onSubmit={saveSettings} className="bg-white border border-gray-100 rounded-card p-5 max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Resend instellingen</h2>
              </div>
              <div className="space-y-3">
                {settings?.api_key_valid === false && (
                  <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-brand-orange">
                    De API-key moet opnieuw worden opgeslagen voordat testmails of campagnes kunnen worden verstuurd.
                  </div>
                )}
                <input
                  value={settingsForm.from_name}
                  onChange={(e) => setSettingsForm({ ...settingsForm, from_name: e.target.value })}
                  placeholder="Afzendernaam"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="email"
                  value={settingsForm.from_email}
                  onChange={(e) => setSettingsForm({ ...settingsForm, from_email: e.target.value })}
                  placeholder="Afzender e-mail"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="email"
                  value={settingsForm.reply_to}
                  onChange={(e) => setSettingsForm({ ...settingsForm, reply_to: e.target.value })}
                  placeholder="Reply-to"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={settingsForm.resend_api_key}
                  onChange={(e) => setSettingsForm({ ...settingsForm, resend_api_key: e.target.value })}
                  placeholder={
                    settings?.has_api_key
                      ? settings.api_key_valid === false
                        ? "Resend API-key opnieuw opslaan"
                        : `Resend API-key aanwezig (...${settings.api_key_last4})`
                      : "Resend API-key"
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={settingsForm.resend_webhook_secret}
                  onChange={(e) => setSettingsForm({ ...settingsForm, resend_webhook_secret: e.target.value })}
                  placeholder={
                    settings?.has_webhook_secret
                      ? settings.webhook_secret_valid === false
                        ? "Webhooksecret opnieuw opslaan"
                        : "Webhooksecret aanwezig"
                      : "Resend webhook signing secret"
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <button
                  type="submit"
                  disabled={busy === "settings" || setupRequired}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy === "settings" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Opslaan
                </button>
              </div>
            </form>
            )}

            {activeSection === "segments" && (
            <form onSubmit={createSegment} className="bg-white border border-gray-100 rounded-card p-5 max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-gray-500" />
                <h2 className="font-semibold">Segment toevoegen</h2>
              </div>
              <div className="space-y-3">
                <input
                  value={segmentForm.name}
                  onChange={(e) => setSegmentForm({ ...segmentForm, name: e.target.value })}
                  placeholder="Segmentnaam"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <select
                  value={segmentForm.source_type}
                  onChange={(e) => setSegmentForm({ ...segmentForm, source_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
                >
                  {SOURCE_TYPES.map((type) => (
                    <option key={type.id} value={type.id}>{type.label}</option>
                  ))}
                </select>
                {segmentForm.source_type === "recipient_email_in" ? (
                  <textarea
                    value={segmentForm.source_value}
                    onChange={(e) => setSegmentForm({ ...segmentForm, source_value: e.target.value })}
                    placeholder={"Plak e-mailadressen onder elkaar of gescheiden met komma's"}
                    rows={4}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  />
                ) : segmentForm.source_type !== "all_marketing" && (
                  <input
                    value={segmentForm.source_value}
                    onChange={(e) => setSegmentForm({ ...segmentForm, source_value: e.target.value })}
                    placeholder={
                      segmentForm.source_type === "without_marketing_segments"
                        ? "Bijv. factor_30,factor_50"
                        : segmentForm.source_type === "recipient_email_contains"
                          ? "Bijv. bol.com"
                          : segmentForm.source_type === "recent_order_days"
                            ? "Bijv. 14"
                          : "Kies hieronder of typ exact"
                    }
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  />
                )}
                {segmentOptions && (
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      Aanwezige data ({segmentOptions.total_marketing || 0} marketingcontacten)
                    </p>
                    {segmentForm.source_type === "all_marketing" ? (
                      <p className="text-sm text-gray-500">Dit segment gebruikt alle contacten met nieuwsbrief toestemming.</p>
                    ) : availableSourceValues.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {availableSourceValues.slice(0, 40).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setSegmentForm({ ...segmentForm, source_value: option.value })}
                            className="px-2.5 py-1 rounded-pill text-xs font-semibold bg-white text-gray-700 border border-gray-200 hover:border-brand-amber"
                          >
                            {option.value} <span className="text-gray-400">({option.count})</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Geen waarden gevonden voor dit type.</p>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy === "segment" || setupRequired}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-pill text-sm font-semibold hover:border-brand-amber disabled:opacity-60"
                >
                  {busy === "segment" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Segment toevoegen
                </button>
                {segments.length > 0 && (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Aangemaakte segmenten</p>
                    <div className="space-y-1.5 max-h-48 overflow-auto">
                      {segments.map((segment) => (
                        <div key={segment.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <p className="font-medium truncate">{segment.name}</p>
                            <p className="text-xs text-gray-400 truncate">
                              {SOURCE_TYPES.find((type) => type.id === segment.source_type)?.label || segment.source_type}
                              {segment.source_value ? `: ${segment.source_value}` : ""}
                            </p>
                          </div>
                          {segment.default_excluded ? (
                            <span className="shrink-0 text-[10px] font-bold uppercase text-red-600 bg-red-50 border border-red-100 rounded-pill px-2 py-0.5">
                              vast
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => deleteSegment(segment)}
                              disabled={busy === `delete-segment-${segment.id}`}
                              className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title="Segment verwijderen"
                            >
                              {busy === `delete-segment-${segment.id}` ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </form>
            )}

            {activeSection === "campaigns" && (
            <form onSubmit={createCampaign} className="bg-white border border-gray-100 rounded-card p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-500" />
                  <h2 className="font-semibold">{editingCampaignId ? "Campagne bewerken" : "Nieuwe campagne"}</h2>
                </div>
                {editingCampaignId && (
                  <button
                    type="button"
                    onClick={cancelEditCampaign}
                    className="text-xs font-semibold text-gray-500 hover:text-brand-black"
                  >
                    Annuleren
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[390px_1fr] gap-5 items-start">
                <div className="space-y-3">
                <input
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="Interne campagnenaam"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  value={campaignForm.subject}
                  onChange={(e) => setCampaignForm({ ...campaignForm, subject: e.target.value })}
                  placeholder="Titel / onderwerp"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <input
                  value={campaignForm.preview_text}
                  onChange={(e) => setCampaignForm({ ...campaignForm, preview_text: e.target.value })}
                  placeholder="Previewtekst"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                />
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase">Verzenddatum en tijd</label>
                  <div className="relative">
                    <CalendarClock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="datetime-local"
                      value={toDateTimeLocal(campaignForm.scheduled_at)}
                      onChange={(e) => setCampaignForm({ ...campaignForm, scheduled_at: fromDateTimeLocal(e.target.value) })}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
                    />
                  </div>
                  {editingCampaignId && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => saveCampaign()}
                        disabled={busy === "campaign" || setupRequired || !targetSegmentIds.length}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-pill text-xs font-semibold border border-gray-200 bg-white hover:border-brand-amber disabled:opacity-60"
                      >
                        <Save className="w-4 h-4" />
                        Tijd opslaan
                      </button>
                      <button
                        type="button"
                        onClick={() => saveCampaign({ sendAfterSave: true })}
                        disabled={busy === "campaign" || busy.startsWith("send-") || setupRequired || !canSaveAndPlanFromForm()}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-pill text-xs font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: accent }}
                        title={
                          canSaveAndPlanFromForm()
                            ? "Tijd opslaan en daarna definitief plannen"
                            : formNeedsRetest(selected, campaignForm)
                              ? "Na inhoud of doelgroep wijzigen eerst opnieuw testmail sturen"
                              : "Kies een toekomstige tijd en stuur eerst een testmail"
                        }
                      >
                        <Send className="w-4 h-4" />
                        Opslaan en plannen
                      </button>
                    </div>
                  )}
                  {editingCampaignId && formNeedsRetest(selected, campaignForm) && (
                    <p className="text-xs text-brand-orange">
                      Inhoud of doelgroep is gewijzigd. Stuur na opslaan opnieuw een testmail voordat je kunt plannen.
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-xs font-semibold text-gray-500 uppercase">Mailen naar</label>
                    <span className="text-xs text-gray-400">{targetSegmentIds.length} gekozen</span>
                  </div>
                  {availableTargetSegments.length ? (
                    <div className="space-y-2 max-h-48 overflow-auto">
                      {availableTargetSegments.map((segment) => {
                        const checked = targetSegmentIds.includes(segment.id);
                        return (
                          <label key={segment.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleTargetSegment(segment.id)}
                                className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                              />
                              <span className="truncate">{segment.name}</span>
                            </span>
                            <span className="shrink-0 text-[10px] font-semibold uppercase text-gray-400">
                              {SOURCE_TYPES.find((type) => type.id === segment.source_type)?.label || segment.source_type}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Maak eerst een doelgroepsegment aan.</p>
                  )}
                  <p className="text-xs text-gray-500">
                    Meerdere doelgroepen worden samengevoegd. Dubbele e-mailadressen worden bij verzending automatisch ontdubbeld.
                  </p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Automatische batches</p>
                      <p className="text-xs text-gray-500">CRM verstuurt pas verder na een groene health-check.</p>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold">
                      <input
                        type="checkbox"
                        checked={campaignForm.batch_mode === "automatic"}
                        onChange={(e) => setCampaignForm({ ...campaignForm, batch_mode: e.target.checked ? "automatic" : "single" })}
                        className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                      />
                      Aan
                    </label>
                  </div>
                  {campaignForm.batch_mode === "automatic" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-semibold text-gray-500">
                        Batchgrootte
                        <input
                          type="number"
                          min="1"
                          max={MAX_RECIPIENT_LIMIT}
                          step="1"
                          value={campaignForm.batch_size}
                          onChange={(e) => setCampaignForm({ ...campaignForm, batch_size: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal text-brand-black focus:outline-none focus:border-brand-amber"
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-500">
                        Wachturen
                        <input
                          type="number"
                          min="0.25"
                          step="0.25"
                          value={campaignForm.batch_wait_hours}
                          onChange={(e) => setCampaignForm({ ...campaignForm, batch_wait_hours: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal text-brand-black focus:outline-none focus:border-brand-amber"
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-500">
                        Max bounce
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.001"
                          value={campaignForm.max_bounce_rate}
                          onChange={(e) => setCampaignForm({ ...campaignForm, max_bounce_rate: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal text-brand-black focus:outline-none focus:border-brand-amber"
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-500">
                        Max complaints
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.001"
                          value={campaignForm.max_complaint_rate}
                          onChange={(e) => setCampaignForm({ ...campaignForm, max_complaint_rate: e.target.value })}
                          className="mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-normal text-brand-black focus:outline-none focus:border-brand-amber"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-500 uppercase">Max totaal ontvangers</label>
                      <input
                        type="number"
                        min="1"
                        max={MAX_RECIPIENT_LIMIT}
                        step="1"
                        value={campaignForm.recipient_limit}
                        onChange={(e) => setCampaignForm({ ...campaignForm, recipient_limit: e.target.value })}
                        placeholder="Geen limiet"
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
                      />
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Niet mailen naar</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Deze segmenten worden van de gekozen doelgroep(en) afgehaald.
                  </p>
                  {availableExclusionSegments.length ? (
                    <div className="space-y-2 max-h-44 overflow-auto">
                      {availableExclusionSegments.map((segment) => {
                        const isDefault = segment.default_excluded;
                        const checked = campaignExcludedIds.has(segment.id);
                        return (
                          <label key={segment.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isDefault}
                                onChange={() => toggleExcludedSegment(segment.id)}
                                className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                              />
                              <span className="truncate">{segment.name}</span>
                            </span>
                            {isDefault && (
                              <span className="shrink-0 text-[10px] font-bold uppercase text-red-600 bg-red-50 border border-red-100 rounded-pill px-2 py-0.5">
                                standaard
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Nog geen segmenten om uit te sluiten.</p>
                  )}
                </div>
                </div>
                <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-1 rounded-xl border border-gray-100 bg-gray-50 p-1">
                    {[
                      { id: "html", label: "HTML" },
                      { id: "preview", label: "Preview" },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setEditorMode(item.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          editorMode === item.id ? "bg-white text-brand-orange shadow-sm" : "text-gray-500 hover:text-brand-black"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">
                    {campaignForm.body_html ? "Preview gebruikt de huidige HTML" : "Nog geen HTML"}
                  </p>
                </div>
                {editorMode === "html" ? (
                  <textarea
                    value={campaignForm.body_html}
                    onChange={(e) => setCampaignForm({ ...campaignForm, body_html: e.target.value })}
                    placeholder="HTML uit Codex of Claude"
                    rows={18}
                    className="w-full min-h-[440px] px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:border-brand-amber"
                  />
                ) : (
                  <div className="w-full min-h-[440px] rounded-xl border border-gray-200 bg-white overflow-hidden">
                    {campaignForm.body_html ? (
                      <iframe
                        title="Nieuwsbrief preview"
                        sandbox=""
                        srcDoc={campaignForm.body_html}
                        className="w-full h-[440px] bg-white"
                      />
                    ) : (
                      <div className="h-[440px] flex items-center justify-center text-sm text-gray-400">
                        Plak of laad eerst HTML om de preview te bekijken.
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy === "campaign" || setupRequired || !targetSegmentIds.length}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy === "campaign" ? <Loader2 className="w-4 h-4 animate-spin" /> : editingCampaignId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {editingCampaignId ? "Wijzigingen opslaan" : "Campagne aanmaken"}
                </button>
                {editingCampaignId && (
                  <button
                    type="button"
                    onClick={() => saveCampaign({ testAfterSave: true })}
                    disabled={busy === "campaign" || !testEmail || setupRequired || !resendReady || !targetSegmentIds.length}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-60"
                  >
                    <Mail className="w-4 h-4" />
                    Opslaan en testmail versturen
                  </button>
                )}
                </div>
              </div>
            </form>
            )}
          </div>

          {activeSection === "campaigns" && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold">Campagnes</h2>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="Testmail naar"
                    className="w-64 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  />
                  <button
                    type="button"
                    onClick={() => selected && sendTest(selected)}
                    disabled={!selected || !canMutateCampaign(selected) || !testEmail || !resendReady || busy === `test-${selected?.id}`}
                    className="flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-40"
                    title={resendReady ? "Testmail versturen" : "Resend API-key opnieuw opslaan"}
                  >
                    {selected && busy === `test-${selected.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Testmail versturen
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Campagne</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Doelgroep</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center text-sm text-gray-400 py-10">Nog geen campagnes</td>
                      </tr>
                    ) : campaigns.map((campaign) => (
                      <tr key={campaign.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold">{campaign.name}</p>
                          <p className="text-xs text-gray-500">{campaign.subject}</p>
                          {campaign.scheduled_at && (
                            <p className="text-xs text-brand-orange mt-1">
                              {scheduledAtLabel(campaign)}: {formatDateTime(campaign.scheduled_at)}
                            </p>
                          )}
                          {campaign.batch_mode === "automatic" ? (
                            <p className="text-xs text-gray-400 mt-1">
                              Batches: {campaign.batch_current_number || 0}/{campaign.batch_total_count || "?"}
                              {campaign.batch_next_run_at ? ` · volgende check ${formatDateTime(campaign.batch_next_run_at)}` : ""}
                            </p>
                          ) : campaign.recipient_limit && (
                            <p className="text-xs text-gray-400 mt-1">
                              Max: {campaign.recipient_limit} ontvangers
                            </p>
                          )}
                          {campaign.batch_pause_reason && (
                            <p className="text-xs text-red-500 mt-1">{campaign.batch_pause_reason}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          <p>
                            {targetSegmentNames(campaign).join(", ") || "Geen doelgroep"}
                          </p>
                          {excludedSegmentNames(campaign).length > 0 && (
                            <p className="text-xs text-red-500 mt-1">
                              Niet mailen: {excludedSegmentNames(campaign).join(", ")}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${statusClass(campaign.status)}`}>
                            {STATUS_LABELS[campaign.status] || campaign.status}
                          </span>
                          {campaign.recipient_count > 0 && (
                            <span className="ml-2 text-xs text-gray-400">{campaign.recipient_count} verzonden</span>
                          )}
                          {campaign.batch_last_health && (
                            <p className="text-xs text-gray-400 mt-1">
                              Laatste check: {campaign.batch_last_health.counts?.bounced || 0} bounce,
                              {" "}{campaign.batch_last_health.counts?.complained || 0} complaint
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => startEditCampaign(campaign)}
                              disabled={!canMutateCampaign(campaign)}
                              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"
                              title={canMutateCampaign(campaign) ? "Campagne bewerken" : "Verzonden campagnes kunnen niet worden bewerkt"}
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => previewRecipients(campaign)}
                              disabled={busy === `preview-${campaign.id}`}
                              className="p-2 rounded-lg text-gray-400 hover:text-brand-orange hover:bg-amber-50 disabled:opacity-50"
                              title="Ontvangers bekijken"
                            >
                              {busy === `preview-${campaign.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => sendTest(campaign)}
                              disabled={busy === `test-${campaign.id}` || !canMutateCampaign(campaign) || !resendReady}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                              title={resendReady ? "Testmail sturen" : "Resend API-key opnieuw opslaan"}
                            >
                              {busy === `test-${campaign.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                              Testmail
                            </button>
                            <button
                              onClick={() => sendCampaign(campaign)}
                              disabled={busy === `send-${campaign.id}` || !canSendCampaign(campaign)}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-gray-500 hover:text-green-600 hover:bg-green-50 disabled:opacity-50"
                              title={sendActionTitle(campaign)}
                            >
                              {busy === `send-${campaign.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              {sendActionLabel(campaign)}
                            </button>
                            <button
                              onClick={() => deleteCampaign(campaign)}
                              disabled={busy === `delete-campaign-${campaign.id}` || !canMutateCampaign(campaign)}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                              title={canMutateCampaign(campaign) ? "Campagne verwijderen" : "Verzonden campagnes kunnen niet worden verwijderd"}
                            >
                              {busy === `delete-campaign-${campaign.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selected && (
              <div className="bg-white border border-gray-100 rounded-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold">{selected.name}</h2>
                    <p className="text-sm text-gray-500">{selected.subject}</p>
                  </div>
                  {selected.test_sent_at && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                      <CheckCircle className="w-4 h-4" />
                      Test verstuurd
                    </span>
                  )}
                </div>
                {canMutateCampaign(selected) && (
                  <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="Testmail naar"
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      />
                      <button
                        type="button"
                        onClick={() => sendTest(selected)}
                        disabled={busy === `test-${selected.id}` || !testEmail || !resendReady}
                        className="flex items-center justify-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: accent }}
                        title={resendReady ? "Testmail versturen" : "Resend API-key opnieuw opslaan"}
                      >
                        {busy === `test-${selected.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                        Testmail versturen
                      </button>
                    </div>
                  </div>
                )}
                {recipients ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-medium">
                          {recipients.count} unieke ontvangers
                          {recipients.limited && recipients.total_count > recipients.count
                            ? ` van ${recipients.total_count}`
                            : ""}
                        </p>
                        {selected.batch_mode === "automatic" ? (
                          <p className="text-xs text-gray-500">
                            Automatisch: batches van {selected.batch_size || 100}, check na {selected.batch_wait_hours || 4} uur
                          </p>
                        ) : recipients.recipient_limit && (
                          <p className="text-xs text-gray-500">
                            Limiet: max. {recipients.recipient_limit} ontvangers
                          </p>
                        )}
                        {recipients.deduplicated_count > 0 && (
                          <p className="text-xs text-amber-700">
                            {recipients.deduplicated_count} dubbele kandidaatadressen verwijderd
                            {recipients.candidate_count ? ` uit ${recipients.candidate_count} kandidaten` : ""}.
                          </p>
                        )}
                        {recipients.suppressed_count > 0 && (
                          <p className="text-xs text-red-600">
                            {recipients.suppressed_count} persoonlijk uitgeschreven/geblokkeerde adres(sen) uitgesloten.
                          </p>
                        )}
                        {recipients.duplicate_address_count > 0 && (
                          <p className="text-xs text-gray-500">
                            {recipients.duplicate_address_count} adres(sen) kwamen meer dan 1 keer voor.
                          </p>
                        )}
                      </div>
                      {recipients.truncated && <p className="text-xs text-gray-400">Eerste 250 getoond</p>}
                    </div>
                    <div className="max-h-80 overflow-auto border border-gray-100 rounded-xl">
                      <table className="w-full">
                        <tbody>
                          {recipients.recipients.map((recipient) => (
                            <tr key={recipient.email} className="border-b border-gray-50">
                              <td className="px-3 py-2 text-sm font-medium">{recipient.email}</td>
                              <td className="px-3 py-2 text-sm text-gray-500">{recipient.name || "—"}</td>
                              <td className="px-3 py-2 text-sm text-gray-500">{recipient.company_name || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Bekijk ontvangers met de gebruikersknop in de campagnelijst.</p>
                )}
              </div>
            )}
          </div>
          )}
        </div>
        </div>
      )}
    </AppShell>
  );
}
