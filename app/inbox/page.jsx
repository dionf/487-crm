"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import RichEditor from "@/components/RichEditor";
import {
  Inbox,
  Mail,
  Archive,
  Reply,
  ExternalLink,
  Phone,
  Clock,
  User,
  Globe,
  Send,
  Loader2,
  Check,
  X,
} from "lucide-react";

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "Zojuist";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min geleden`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} uur geleden`;
  if (diff < 172800000) return "Gisteren";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_LABELS = {
  nieuw: { label: "Nieuw", color: "bg-blue-100 text-blue-700" },
  gelezen: { label: "Gelezen", color: "bg-gray-100 text-gray-600" },
  beantwoord: { label: "Beantwoord", color: "bg-green-100 text-green-700" },
  gearchiveerd: { label: "Gearchiveerd", color: "bg-gray-100 text-gray-400" },
};

export default function InboxPageWrapper() {
  return (
    <Suspense fallback={<AppShell><div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" /></div></AppShell>}>
      <InboxPage />
    </Suspense>
  );
}

function InboxPage() {
  const { tenant } = useOrg();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("nieuw");
  const [selected, setSelected] = useState(null);

  // Reply state
  const [showReply, setShowReply] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySent, setReplySent] = useState(false);

  async function fetchSubmissions() {
    try {
      const res = await apiFetch(`/api/inbox?status=${filter}`);
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Auto-select from URL param
  useEffect(() => {
    if (selectedId && submissions.length > 0) {
      const found = submissions.find((s) => s.id === selectedId);
      if (found) handleSelect(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, submissions]);

  async function handleSelect(sub) {
    setSelected(sub);
    setShowReply(false);
    setReplySent(false);
    setReplyError("");

    // Mark as read only if status is "nieuw" (don't downgrade beantwoord/gearchiveerd)
    if (sub.status === "nieuw") {
      await apiFetch(`/api/inbox/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "gelezen" }),
      });
      const updatedSub = { ...sub, status: "gelezen" };
      setSubmissions((prev) =>
        prev.map((s) => (s.id === sub.id ? updatedSub : s))
      );
      setSelected(updatedSub);
      window.dispatchEvent(new Event("inbox-updated"));
    }
  }

  async function handleArchive(id) {
    await apiFetch(`/api/inbox/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "gearchiveerd" }),
    });
    setSubmissions((prev) => prev.filter((s) => s.id !== id));
    if (selected?.id === id) setSelected(null);
    window.dispatchEvent(new Event("inbox-updated"));
  }

  function openReply() {
    if (!selected) return;
    setReplySubject(`Re: Contactaanvraag van ${selected.first_name} ${selected.last_name}`);
    const signature =
      tenant === "hiphot"
        ? `<p>Met zonnige groet,</p><p><br></p><p><strong>HIPHOT</strong><br>(+31) 085-505 56 64<br>hiphot.nl</p>`
        : `<p>Met vriendelijke groet,</p><p><br></p><p><strong>48-7 AI Professionals</strong><br>(+31) 085-06 01 487<br>48-7.nl</p>`;
    setReplyBody(`<p>Hallo ${selected.first_name},</p><p><br></p><p><br></p>${signature}`);
    setShowReply(true);
    setReplySent(false);
    setReplyError("");
  }

  async function handleSendReply() {
    if (!replySubject || !replyBody) {
      setReplyError("Vul onderwerp en tekst in");
      return;
    }
    setSending(true);
    setReplyError("");
    try {
      const res = await apiFetch(`/api/inbox/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: replySubject, body_html: replyBody }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReplySent(true);
      setSelected((prev) => (prev ? { ...prev, status: "beantwoord", replied_at: new Date().toISOString() } : prev));
      setSubmissions((prev) =>
        prev.map((s) => (s.id === selected.id ? { ...s, status: "beantwoord" } : s))
      );
      window.dispatchEvent(new Event("inbox-updated"));
      // Re-fetch from server to ensure consistency
      setTimeout(() => fetchSubmissions(), 500);
    } catch (err) {
      setReplyError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell fullWidth>
      <div className="flex h-[calc(100vh-64px)]">
        {/* Sidebar */}
        <div className="w-96 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
          <div className="px-4 py-3 border-b border-gray-100">
            <h1 className="text-lg font-bold text-brand-black flex items-center gap-2">
              <Inbox className="w-5 h-5" />
              Inbox
            </h1>
            <div className="flex gap-1 mt-3">
              {["nieuw", "beantwoord", "gearchiveerd", "alle"].map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setSelected(null); }}
                  className={`px-3 py-1 rounded-pill text-xs font-medium transition-colors ${
                    filter === f
                      ? "bg-brand-amber text-brand-black"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {f === "alle" ? "Alle" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </div>
            ) : submissions.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Geen berichten
              </div>
            ) : (
              submissions.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSelect(sub)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    selected?.id === sub.id ? "bg-amber-50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${sub.status === "nieuw" ? "text-brand-black" : "text-gray-600"}`}>
                      {sub.first_name} {sub.last_name}
                    </span>
                    <span className="text-[10px] text-gray-400">{formatDate(sub.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{sub.email}</p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{sub.message}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-pill ${STATUS_LABELS[sub.status]?.color || "bg-gray-100"}`}>
                      {STATUS_LABELS[sub.status]?.label || sub.status}
                    </span>
                    {sub.status === "nieuw" && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <Mail className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">Selecteer een bericht</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl p-6">
              {/* Header */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-brand-black">
                      {selected.first_name} {selected.last_name}
                    </h2>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" />
                        <a href={`mailto:${selected.email}`} className="text-brand-orange hover:underline">
                          {selected.email}
                        </a>
                      </span>
                      {selected.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5" />
                          <a href={`tel:${selected.phone}`} className="hover:underline">{selected.phone}</a>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(selected.created_at).toLocaleString("nl-NL")}
                      </span>
                      {selected.source_url && (
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {selected.source_url.replace(/^https?:\/\//, "").split("/").slice(0, 2).join("/")}
                        </span>
                      )}
                      {selected.language && selected.language !== "nl" && (
                        <span className="uppercase font-medium">{selected.language}</span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-3 py-1 rounded-pill ${STATUS_LABELS[selected.status]?.color}`}>
                    {STATUS_LABELS[selected.status]?.label}
                  </span>
                </div>
              </div>

              {/* Message */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {selected.message}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 mb-4">
                {selected.lead_id ? (
                  <button
                    onClick={() => router.push(`/leads/${selected.lead_id}`)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium hover:bg-white transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Bekijk lead
                    <ExternalLink className="w-3 h-3 text-gray-400" />
                  </button>
                ) : null}
                <button
                  onClick={openReply}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
                >
                  <Reply className="w-4 h-4" />
                  Beantwoorden
                </button>
                {selected.status !== "gearchiveerd" && (
                  <button
                    onClick={() => handleArchive(selected.id)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium text-gray-500 hover:bg-white transition-colors"
                  >
                    <Archive className="w-4 h-4" />
                    Archiveren
                  </button>
                )}
              </div>

              {/* Reply form */}
              {showReply && !replySent && (
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                    Antwoord
                  </h3>
                  {replyError && (
                    <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl mb-3">{replyError}</div>
                  )}
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Aan</label>
                    <p className="text-sm mt-1 text-gray-700">{selected.email}</p>
                  </div>
                  <div className="mb-3">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Onderwerp</label>
                    <input
                      value={replySubject}
                      onChange={(e) => setReplySubject(e.target.value)}
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bericht</label>
                    <div className="mt-1">
                      <RichEditor value={replyBody} onChange={setReplyBody} minHeight="180px" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowReply(false)}
                      className="px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                      Annuleren
                    </button>
                    <button
                      onClick={handleSendReply}
                      disabled={sending}
                      className="flex items-center gap-2 px-5 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-40"
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Versturen
                    </button>
                  </div>
                </div>
              )}

              {replySent && (
                <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6 text-center">
                  <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <p className="text-green-700 font-semibold">Antwoord verstuurd!</p>
                </div>
              )}

              {selected.replied_at && !showReply && !replySent && (
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Reply className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-semibold text-gray-500">Verstuurd antwoord</span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {selected.replied_by && `${selected.replied_by} · `}
                      {new Date(selected.replied_at).toLocaleString("nl-NL")}
                    </span>
                  </div>
                  {selected.reply_subject && (
                    <p className="text-sm font-medium text-gray-700 mb-2">{selected.reply_subject}</p>
                  )}
                  {selected.reply_body_html ? (
                    <div
                      className="text-sm text-gray-600 prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: selected.reply_body_html }}
                    />
                  ) : (
                    <p className="text-xs text-gray-400 italic">Antwoord niet opgeslagen</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
