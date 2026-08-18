"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import { apiFetch, isAdminFromSession } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Save,
  Settings2,
} from "lucide-react";

const LANGS = [
  { code: "all", label: "Alle talen" },
  { code: "de", label: "DE" },
  { code: "en", label: "EN" },
  { code: "nl", label: "NL" },
];

const STATUSES = [
  { code: "all", label: "Alle statussen" },
  { code: "incomplete", label: "Niet afgerond" },
  { code: "complete", label: "Afgerond" },
];

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function messagePreview(history) {
  if (!Array.isArray(history) || history.length === 0) return "Geen transcript";
  const last = [...history].reverse().find((m) => m?.content);
  return String(last?.content || "").replace(/\s+/g, " ").slice(0, 140);
}

function statusBadge(status) {
  const complete = status === "complete";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        complete ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {complete ? <CheckCircle2 className="w-3 h-3" /> : <Clock3 className="w-3 h-3" />}
      {complete ? "Afgerond" : "Niet afgerond"}
    </span>
  );
}

export default function HipHotChatsPage() {
  const { tenant, isAdmin } = useOrg();
  const effectiveAdmin = isAdmin || isAdminFromSession();
  const [tab, setTab] = useState("conversations");
  const [status, setStatus] = useState("all");
  const [lang, setLang] = useState("all");
  const [conversations, setConversations] = useState([]);
  const [summary, setSummary] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [variants, setVariants] = useState([]);
  const [editingConfig, setEditingConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) || conversations[0] || null,
    [conversations, selectedId]
  );

  async function fetchConversations() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ source: "shopify_eu", limit: "150" });
      if (status !== "all") params.set("status", status);
      if (lang !== "all") params.set("lang", lang);
      const res = await apiFetch(`/api/hiphot/chat-conversations?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kon gesprekken niet laden");
      setConversations(data.conversations || []);
      setSummary(data.summary || {});
      setSelectedId((current) => {
        if (current && (data.conversations || []).some((c) => c.id === current)) return current;
        return data.conversations?.[0]?.id || null;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchConfigs(preferActive = false) {
    setConfigsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/hiphot/chat-configs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Kon prompts niet laden");
      setConfigs(data.configs || []);
      setVariants(data.variants || []);
      setEditingConfig((current) => {
        if (preferActive) return data.variants?.find((v) => v.is_active) || data.variants?.[0] || null;
        if (!current) return data.variants?.find((v) => v.is_active) || data.variants?.[0] || null;
        return (
          data.variants?.find((v) => v.lang === current.lang && v.variant_key === current.variant_key) ||
          data.variants?.find((v) => v.is_active) ||
          data.variants?.[0] ||
          null
        );
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setConfigsLoading(false);
    }
  }

  useEffect(() => {
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lang]);

  useEffect(() => {
    if (tab === "prompts" && configs.length === 0) fetchConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function saveConfig() {
    if (!editingConfig || !effectiveAdmin) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/hiphot/chat-configs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang: editingConfig.lang,
          variant_key: editingConfig.variant_key,
          label: editingConfig.label,
          system_prompt: editingConfig.system_prompt,
          welcome_message: editingConfig.welcome_message,
          phone_pattern: editingConfig.phone_pattern || null,
          activate: editingConfig.is_active === true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setVariants((items) =>
        items.map((item) =>
          item.lang === data.variant.lang && item.variant_key === data.variant.variant_key ? data.variant : item
        )
      );
      setEditingConfig(data.variant);
      setMessage("Prompt opgeslagen. Nieuwe chats gebruiken dit na maximaal 60 seconden cache.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function activateConfigVariant() {
    if (!editingConfig || !effectiveAdmin) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch("/api/hiphot/chat-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate",
          lang: editingConfig.lang,
          variant_key: editingConfig.variant_key,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Activeren mislukt");
      await fetchConfigs(true);
      setMessage("Variant actief gezet. Nieuwe chats gebruiken dit na maximaal 60 seconden cache.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (tenant && tenant !== "hiphot") {
    return (
      <AppShell>
        <div className="p-6 rounded-2xl border border-red-100 bg-red-50 text-red-700">
          Deze pagina is alleen beschikbaar voor tenant hiphot.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-brand-black flex items-center gap-2">
              <MessageSquareText className="w-6 h-6 text-brand-amber" />
              Shopify quote chats
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Overzicht van afgeronde en niet-afgeronde Sunny gesprekken voor tenant hiphot.
            </p>
          </div>
          <button
            onClick={tab === "prompts" ? fetchConfigs : fetchConversations}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Vernieuwen
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          {[
            { id: "conversations", label: "Gesprekken" },
            { id: "prompts", label: "Prompts" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
                tab === item.id
                  ? "border-brand-amber text-brand-orange"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm border border-red-100">
            {error}
          </div>
        )}
        {message && (
          <div className="mb-4 p-3 rounded-xl bg-green-50 text-green-700 text-sm border border-green-100">
            {message}
          </div>
        )}

        {tab === "conversations" ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {STATUSES.map((s) => (
                <button
                  key={s.code}
                  onClick={() => setStatus(s.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    status === s.code
                      ? "bg-brand-amber text-brand-black"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <span className="w-px h-5 bg-gray-200 mx-1" />
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                    lang === l.code
                      ? "bg-brand-amber text-brand-black"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {l.label}
                </button>
              ))}
              <div className="ml-auto text-xs text-gray-500">
                Zichtbaar: {conversations.length} · Samenvatting:{" "}
                {Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 min-h-[620px]">
              <div className="border border-gray-100 rounded-2xl overflow-hidden bg-white">
                {loading ? (
                  <div className="py-16 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="p-8 text-sm text-gray-500 text-center">Geen gesprekken gevonden.</div>
                ) : (
                  <div className="divide-y divide-gray-100 max-h-[720px] overflow-y-auto">
                    {conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        onClick={() => setSelectedId(conversation.id)}
                        className={`w-full text-left p-4 hover:bg-gray-50 ${
                          selected?.id === conversation.id ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="font-semibold text-sm text-brand-black truncate">
                            {conversation.bedrijf || conversation.naam || conversation.email || "Onbekende bezoeker"}
                          </div>
                          {statusBadge(conversation.status)}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
                          <span className="uppercase font-bold">{conversation.lang}</span>
                          <span>{formatDate(conversation.updated_at || conversation.created_at)}</span>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2">
                          {messagePreview(conversation.chat_history)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-gray-100 rounded-2xl bg-white overflow-hidden">
                {!selected ? (
                  <div className="p-10 text-sm text-gray-500 text-center">Selecteer een gesprek.</div>
                ) : (
                  <div className="h-full flex flex-col">
                    <div className="p-5 border-b border-gray-100">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-bold text-brand-black">
                            {selected.bedrijf || selected.naam || "Chatgesprek"}
                          </h2>
                          <p className="text-sm text-gray-500">
                            {selected.naam || "Naam onbekend"} · {selected.email || "Geen e-mail"} ·{" "}
                            {selected.telefoon || "Geen telefoon"}
                          </p>
                        </div>
                        {statusBadge(selected.status)}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
                        <div className="p-2 rounded-xl bg-gray-50">
                          <span className="block text-gray-400">Taal</span>
                          <b className="uppercase">{selected.lang}</b>
                        </div>
                        <div className="p-2 rounded-xl bg-gray-50">
                          <span className="block text-gray-400">Bron</span>
                          <b>{selected.source}</b>
                        </div>
                        <div className="p-2 rounded-xl bg-gray-50">
                          <span className="block text-gray-400">Aangemaakt</span>
                          <b>{formatDate(selected.created_at)}</b>
                        </div>
                        <div className="p-2 rounded-xl bg-gray-50">
                          <span className="block text-gray-400">Bijgewerkt</span>
                          <b>{formatDate(selected.updated_at)}</b>
                        </div>
                      </div>
                    </div>

                    <div className="p-5 overflow-y-auto max-h-[640px] space-y-3">
                      {Array.isArray(selected.chat_history) && selected.chat_history.length > 0 ? (
                        selected.chat_history.map((msg, index) => (
                          <div
                            key={`${index}-${msg.role}`}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                                msg.role === "user"
                                  ? "bg-brand-amber text-brand-black"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              <div className="text-[10px] font-bold uppercase opacity-60 mb-1">
                                {msg.role === "user" ? "Klant" : "Sunny"}
                              </div>
                              {String(msg.content || "").replace(/```json[\s\S]*?```/g, "").trim()}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">Geen transcript opgeslagen.</p>
                      )}

                      {selected.conversation_json && (
                        <details className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                            JSON data
                          </summary>
                          <pre className="mt-3 overflow-auto text-xs leading-relaxed">
                            {JSON.stringify(selected.conversation_json, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
            <div className="border border-gray-100 rounded-2xl bg-white p-2 h-fit">
              {configsLoading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
                </div>
              ) : (
                variants.map((config) => (
                  <button
                    key={`${config.lang}-${config.variant_key}`}
                    onClick={() => setEditingConfig(config)}
                    className={`w-full text-left px-3 py-3 rounded-xl ${
                      editingConfig?.lang === config.lang && editingConfig?.variant_key === config.variant_key
                        ? "bg-amber-50 text-brand-orange"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold uppercase">{config.lang}</div>
                      {config.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-bold">
                          actief
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium text-gray-700 mt-1">{config.label || config.variant_key}</div>
                    <div className="text-[11px] text-gray-500">{formatDate(config.updated_at)}</div>
                  </button>
                ))
              )}
            </div>

            <div className="border border-gray-100 rounded-2xl bg-white p-5">
              {!editingConfig ? (
                <div className="text-sm text-gray-500">Selecteer een prompt.</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-brand-black flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-brand-amber" />
                        Prompt {editingConfig.lang.toUpperCase()} · {editingConfig.label || editingConfig.variant_key}
                      </h2>
                      <p className="text-xs text-gray-500">
                        Variant: <span className="font-mono">{editingConfig.variant_key}</span> ·{" "}
                        {editingConfig.is_active ? "actief" : "niet actief"} · Laatst bijgewerkt:{" "}
                        {formatDate(editingConfig.updated_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!editingConfig.is_active && (
                        <button
                          onClick={activateConfigVariant}
                          disabled={!effectiveAdmin || saving}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold disabled:opacity-50 hover:bg-gray-50"
                          title={!effectiveAdmin ? "Admin-rechten nodig" : "Activeren"}
                        >
                          Activeer variant
                        </button>
                      )}
                      <button
                        onClick={saveConfig}
                        disabled={!effectiveAdmin || saving}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-amber text-brand-black text-sm font-bold disabled:opacity-50"
                        title={!effectiveAdmin ? "Admin-rechten nodig" : "Opslaan"}
                      >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Opslaan
                      </button>
                    </div>
                  </div>

                  {!effectiveAdmin && (
                    <div className="p-3 rounded-xl bg-amber-50 text-amber-700 text-sm">
                      Je kunt prompts bekijken. Bewerken vereist admin-rechten.
                    </div>
                  )}

                  <label className="block">
                    <span className="block text-xs font-bold uppercase text-gray-400 mb-1">Variantnaam</span>
                    <input
                      value={editingConfig.label || ""}
                      disabled={!effectiveAdmin}
                      onChange={(e) => setEditingConfig({ ...editingConfig, label: e.target.value })}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-bold uppercase text-gray-400 mb-1">Welkomstbericht</span>
                    <textarea
                      value={editingConfig.welcome_message || ""}
                      disabled={!effectiveAdmin}
                      onChange={(e) => setEditingConfig({ ...editingConfig, welcome_message: e.target.value })}
                      rows={6}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-bold uppercase text-gray-400 mb-1">Telefoon patroon</span>
                    <input
                      value={editingConfig.phone_pattern || ""}
                      disabled={!effectiveAdmin}
                      onChange={(e) => setEditingConfig({ ...editingConfig, phone_pattern: e.target.value })}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
                      placeholder="Leeg = standaard 7-15 cijfers"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-xs font-bold uppercase text-gray-400 mb-1">System prompt</span>
                    <textarea
                      value={editingConfig.system_prompt || ""}
                      disabled={!effectiveAdmin}
                      onChange={(e) => setEditingConfig({ ...editingConfig, system_prompt: e.target.value })}
                      rows={28}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-brand-amber disabled:bg-gray-50"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
