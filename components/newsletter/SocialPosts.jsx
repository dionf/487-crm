"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { SECTIONS } from "@/components/newsletter/PersonalizedContentEditor";
import { SOCIAL_CHANNELS, formatSocialPost } from "@/lib/newsletter-social-shared";

const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber";
const CHANNEL_LABELS = Object.fromEntries(SOCIAL_CHANNELS.map((channel) => [channel.id, channel.label]));
const key = (itemId, channel) => `${itemId}:${channel}`;

async function readJson(res, fallback) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallback);
  return json;
}

function toForm(post) {
  const content = post.content || {};
  return { ...content, hashtags: (content.hashtags || []).join(" ") };
}

function PostCard({ campaignId, post, item, onSaved, onDeleted, onRegenerate, regenerating }) {
  const [form, setForm] = useState(() => toForm(post));
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(post));
  const stale = item && post.generated_at && Date.parse(item.updated_at) > Date.parse(post.generated_at);
  const base = `/api/newsletter/campaigns/${campaignId}/social-posts/${post.id}`;

  useEffect(() => {
    setForm(toForm(post));
  }, [post]);

  async function save() {
    setBusy("save");
    setError("");
    try {
      const json = await readJson(
        await apiFetch(base, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: form }),
        }),
        "Opslaan mislukt"
      );
      onSaved(json.post);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!confirm(`${CHANNEL_LABELS[post.channel]}-post bij "${item?.title || "dit item"}" verwijderen?`)) return;
    setBusy("delete");
    setError("");
    try {
      await readJson(await apiFetch(base, { method: "DELETE" }), "Verwijderen mislukt");
      onDeleted(post);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  async function copy() {
    setError("");
    try {
      const content = { ...form, hashtags: String(form.hashtags || "").split(/\s+/).filter(Boolean) };
      await navigator.clipboard.writeText(formatSocialPost(post.channel, content));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Kopiëren lukte niet; selecteer de tekst handmatig");
    }
  }

  function regenerate() {
    if (dirty && !confirm("Je niet-opgeslagen wijzigingen gaan verloren. Toch opnieuw genereren?")) return;
    onRegenerate(post.item_id, post.channel);
  }

  const field = (name) => ({ value: form[name] || "", onChange: (e) => setForm({ ...form, [name]: e.target.value }) });

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          <span className="text-brand-orange">{CHANNEL_LABELS[post.channel]}</span>
          <span className="text-gray-400"> · </span>
          {item?.title || "Verwijderd item"}
        </p>
        {stale && <span className="text-xs text-amber-700">Item gewijzigd na genereren</span>}
      </div>

      {post.channel === "linkedin" ? (
        <>
          <input {...field("hook")} placeholder="Hook (eerste regel)" className={`${inputClass} font-semibold`} />
          <textarea {...field("body")} rows={8} placeholder="Tekst" className={inputClass} />
          {item?.url && (
            <p className="text-xs text-gray-500">
              Link voor de eerste reactie: <a href={item.url} target="_blank" rel="noreferrer" className="text-brand-orange break-all">{item.url}</a>
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          {item?.image_url && (
            <a href={item.image_url} target="_blank" rel="noreferrer" className="shrink-0" title="Beeld openen">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.image_url} alt="" className="w-32 h-32 rounded-lg object-cover border border-gray-100" />
            </a>
          )}
          <div className="flex-1 space-y-2">
            <textarea {...field("caption")} rows={7} placeholder="Caption" className={inputClass} />
            <label className="block text-xs font-semibold text-gray-500">
              {item?.image_url ? "Beeld: het itembeeld, met deze suggestie" : "Beeldsuggestie"}
              <textarea {...field("image_suggestion")} rows={2} className={`${inputClass} mt-1 font-normal`} />
            </label>
          </div>
        </div>
      )}
      <input {...field("hashtags")} placeholder="#hashtags" className={`${inputClass} text-brand-orange`} />

      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold text-white bg-brand-black">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Gekopieerd" : "Kopieer"}
        </button>
        {dirty && (
          <button type="button" onClick={save} disabled={Boolean(busy)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-50">
            {busy === "save" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Opslaan
          </button>
        )}
        <button type="button" onClick={regenerate} disabled={Boolean(busy) || regenerating || !item} className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-50">
          {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Opnieuw
        </button>
        {post.channel === "instagram" && item?.image_url && (
          <a href={item.image_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber">
            <ExternalLink className="w-3.5 h-3.5" />
            Beeld openen
          </a>
        )}
        <button type="button" onClick={remove} disabled={Boolean(busy)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold text-gray-500 hover:text-red-600 disabled:opacity-50">
          {busy === "delete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          Verwijderen
        </button>
      </div>
    </div>
  );
}

// Optioneel: per item een LinkedIn- en/of Instagram-post genereren, bewerken en kopiëren.
// Er wordt niets automatisch gemaakt; alleen wat de redacteur aanvinkt.
export default function SocialPosts({ campaign, items }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [running, setRunning] = useState(null); // { done, total }
  const [regenerating, setRegenerating] = useState("");
  const [error, setError] = useState("");
  const base = `/api/newsletter/campaigns/${campaign.id}/social-posts`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await readJson(await apiFetch(base), "Posts laden mislukt");
        if (!cancelled) setPosts(json.posts || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const existing = useMemo(() => new Set(posts.map((post) => key(post.item_id, post.channel))), [posts]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const orderedPosts = useMemo(() => {
    const order = new Map(items.map((item, index) => [item.id, index]));
    const channelOrder = SOCIAL_CHANNELS.map((channel) => channel.id);
    return [...posts].sort(
      (a, b) =>
        (order.get(a.item_id) ?? Infinity) - (order.get(b.item_id) ?? Infinity) ||
        channelOrder.indexOf(a.channel) - channelOrder.indexOf(b.channel)
    );
  }, [posts, items]);

  function upsertPost(post) {
    setPosts((current) => [...current.filter((entry) => entry.id !== post.id && key(entry.item_id, entry.channel) !== key(post.item_id, post.channel)), post]);
  }

  async function generateOne(itemId, channel) {
    const json = await readJson(
      await apiFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, channel }),
      }),
      "Post maken mislukt"
    );
    upsertPost(json.post);
  }

  function toggle(itemId, channel) {
    setSelected((current) => {
      const next = new Set(current);
      const k = key(itemId, channel);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function generateSelected() {
    const todo = [...selected].map((entry) => entry.split(":"));
    setError("");
    setRunning({ done: 0, total: todo.length });
    const failed = [];
    for (const [index, [itemId, channel]] of todo.entries()) {
      try {
        await generateOne(itemId, channel);
        setSelected((current) => {
          const next = new Set(current);
          next.delete(key(itemId, channel));
          return next;
        });
      } catch (err) {
        failed.push(`${itemsById.get(itemId)?.title || "item"} (${CHANNEL_LABELS[channel]}): ${err.message}`);
      }
      setRunning({ done: index + 1, total: todo.length });
    }
    setRunning(null);
    if (failed.length) setError(failed.join("\n"));
  }

  async function regenerate(itemId, channel) {
    setRegenerating(key(itemId, channel));
    setError("");
    try {
      await generateOne(itemId, channel);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating("");
    }
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  if (!items.length) {
    return <p className="text-xs text-gray-500">Voeg eerst items toe bij Inhoud. Daarna kun je hier per item een social post laten maken.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Optioneel: kies voor welke items je een LinkedIn-post (namens de 48-7-bedrijfspagina) en/of een Instagram-post wilt.
        De posts zijn voor alle volgers, niet per bedrijf, en hebben geen invloed op de nieuwsbrief of de testmail.
      </p>
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm whitespace-pre-line">{error}</div>}

      <div className="rounded-xl border border-gray-100 p-3 space-y-3">
        {SECTIONS.map((section) => {
          const sectionItems = items.filter((item) => item.section === section.id);
          if (!sectionItems.length) return null;
          return (
            <div key={section.id} className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase">{section.label}</p>
              {sectionItems.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-sm min-w-0 flex-1 truncate">{item.title}</p>
                  <div className="flex items-center gap-4">
                    {SOCIAL_CHANNELS.map((channel) =>
                      existing.has(key(item.id, channel.id)) ? (
                        <span key={channel.id} className="flex items-center gap-1 text-xs font-semibold text-green-700">
                          <Check className="w-3.5 h-3.5" />
                          {channel.label}
                        </span>
                      ) : (
                        <label key={channel.id} className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.has(key(item.id, channel.id))}
                            onChange={() => toggle(item.id, channel.id)}
                            disabled={Boolean(running)}
                            className="accent-brand-orange"
                          />
                          {channel.label}
                        </label>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        <button
          type="button"
          onClick={generateSelected}
          disabled={!selected.size || Boolean(running)}
          className="flex items-center gap-2 px-4 py-2 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {running
            ? `Posts maken... ${running.done}/${running.total}`
            : `Genereer ${selected.size || ""} ${selected.size === 1 ? "post" : "posts"}`.replace("  ", " ")}
        </button>
      </div>

      {orderedPosts.map((post) => (
        <PostCard
          key={post.id}
          campaignId={campaign.id}
          post={post}
          item={itemsById.get(post.item_id)}
          onSaved={upsertPost}
          onDeleted={(removed) => setPosts((current) => current.filter((entry) => entry.id !== removed.id))}
          onRegenerate={regenerate}
          regenerating={regenerating === key(post.item_id, post.channel)}
        />
      ))}
    </div>
  );
}
