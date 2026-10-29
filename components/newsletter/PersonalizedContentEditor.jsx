"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Edit3, Loader2, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export const SECTIONS = [
  { id: "company_news", label: "Nieuws van 48-7", hint: "Projecten, producten en diensten" },
  { id: "ai_news", label: "AI-nieuws", hint: "Ontwikkelingen in de AI-wereld" },
  { id: "tips", label: "Tips & tricks", hint: "Praktisch en direct toepasbaar" },
];

const EMPTY_ITEM = { title: "", body: "", url: "", link_label: "", image_url: "" };
const inputClass = "w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber";

async function readJson(res, fallback) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallback);
  return json;
}

function ItemForm({ campaignId, section, initial, onSave, onCancel, busy }) {
  const [form, setForm] = useState({ ...EMPTY_ITEM, ...initial });
  const [draftInput, setDraftInput] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");

  async function makeDraft() {
    setDrafting(true);
    setError("");
    try {
      const res = await apiFetch(`/api/newsletter/campaigns/${campaignId}/items/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, input: draftInput, url: form.url }),
      });
      const { draft } = await readJson(res, "Concept maken mislukt");
      setForm((current) => ({
        ...current,
        title: draft.title || current.title,
        body: draft.body || current.body,
        link_label: draft.link_label || current.link_label,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-2">
      <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase">
          <Sparkles className="w-3.5 h-3.5 text-brand-orange" />
          AI-concept
        </p>
        <textarea
          value={draftInput}
          onChange={(e) => setDraftInput(e.target.value)}
          rows={2}
          placeholder="Waar gaat het over? Een paar steekwoorden is genoeg. Vul hieronder ook de link in als die er is."
          className={inputClass}
        />
        <button
          type="button"
          onClick={makeDraft}
          disabled={drafting || (!draftInput.trim() && !form.url.trim())}
          className="flex items-center gap-2 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber disabled:opacity-50"
        >
          {drafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {drafting ? "Concept schrijven..." : "Schrijf concept"}
        </button>
        <p className="text-xs text-gray-400">Het concept vult titel, tekst en linktekst. Pas het daarna zelf aan.</p>
      </div>
      <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titel" className={inputClass} />
      <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={4} placeholder="Tekst (2-4 zinnen)" className={inputClass} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Link (https://...)" className={inputClass} />
        <input value={form.link_label} onChange={(e) => setForm({ ...form, link_label: e.target.value })} placeholder="Linktekst, bijv. Lees de case" className={inputClass} />
      </div>
      <input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="Afbeelding-URL (optioneel)" className={inputClass} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(form)}
          disabled={busy || !form.title.trim() || !form.body.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-pill text-xs font-semibold text-white bg-brand-black disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Opslaan
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-pill text-xs font-semibold text-gray-500 hover:text-brand-black">
          Annuleren
        </button>
      </div>
    </div>
  );
}

// Items per sectie: toevoegen (met AI-concept), bewerken, volgorde en verwijderen.
export default function PersonalizedContentEditor({ campaign, editable, onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { section, id? }
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const base = `/api/newsletter/campaigns/${campaign.id}/items`;

  async function load() {
    try {
      const json = await readJson(await apiFetch(base), "Items laden mislukt");
      setItems(json.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign.id]);

  async function mutate(key, request, fallback) {
    setBusy(key);
    setError("");
    try {
      await readJson(await request(), fallback);
      await load();
      setEditing(null);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  function saveItem(section, form, id) {
    const body = JSON.stringify({ ...form, section });
    return mutate(
      "save",
      () => apiFetch(id ? `${base}/${id}` : base, {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
      "Item opslaan mislukt"
    );
  }

  function deleteItem(item) {
    if (!confirm(`Item "${item.title}" verwijderen? De personalisaties van dit item vervallen ook.`)) return;
    return mutate(`delete-${item.id}`, () => apiFetch(`${base}/${item.id}`, { method: "DELETE" }), "Verwijderen mislukt");
  }

  async function move(sectionItems, index, direction) {
    const other = sectionItems[index + direction];
    const item = sectionItems[index];
    if (!other) return;
    setBusy(`move-${item.id}`);
    setError("");
    try {
      // Herschrijf de volgorde van de hele sectie, zodat dubbele sort_order-waarden verdwijnen.
      const reordered = [...sectionItems];
      reordered[index] = other;
      reordered[index + direction] = item;
      for (const [position, entry] of reordered.entries()) {
        if (entry.sort_order === position) continue;
        await readJson(
          await apiFetch(`${base}/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sort_order: position }),
          }),
          "Volgorde wijzigen mislukt"
        );
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="px-3 py-2 rounded-xl bg-red-50 text-red-600 text-sm">{error}</div>}
      {!editable && (
        <p className="text-xs text-gray-500">Deze campagne is verzonden of wordt verwerkt; de inhoud kan niet meer worden gewijzigd.</p>
      )}
      {editable && items.length > 0 && (
        <p className="text-xs text-gray-500">
          Let op: elke inhoudelijke wijziging zet goedgekeurde personalisaties terug naar concept en vraagt om een nieuwe testmail.
        </p>
      )}
      {SECTIONS.map((section) => {
        const sectionItems = items.filter((item) => item.section === section.id);
        return (
          <div key={section.id} className="rounded-xl border border-gray-100 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{section.label}</p>
                <p className="text-xs text-gray-400">{section.hint}</p>
              </div>
              {editable && !(editing?.section === section.id && !editing.id) && (
                <button
                  type="button"
                  onClick={() => setEditing({ section: section.id })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 hover:border-brand-amber"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Item
                </button>
              )}
            </div>
            {sectionItems.length === 0 && !(editing?.section === section.id) && (
              <p className="text-xs text-gray-400">Nog geen items. Een sectie zonder items komt niet in de mail.</p>
            )}
            {sectionItems.map((item, index) => (
              editing?.id === item.id ? (
                <ItemForm
                  key={item.id}
                  campaignId={campaign.id}
                  section={section.id}
                  initial={{
                    title: item.title || "",
                    body: item.body || "",
                    url: item.url || "",
                    link_label: item.link_label || "",
                    image_url: item.image_url || "",
                  }}
                  busy={busy === "save"}
                  onSave={(form) => saveItem(section.id, form, item.id)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div key={item.id} className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-gray-600 whitespace-pre-line">{item.body}</p>
                    {item.url && (
                      <p className="text-xs text-brand-orange truncate mt-1">{item.link_label || "Link"}: {item.url}</p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex items-center shrink-0">
                      <button type="button" onClick={() => move(sectionItems, index, -1)} disabled={index === 0 || Boolean(busy)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Omhoog">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => move(sectionItems, index, 1)} disabled={index === sectionItems.length - 1 || Boolean(busy)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Omlaag">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditing({ section: section.id, id: item.id })} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700" title="Bewerken">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => deleteItem(item)} disabled={busy === `delete-${item.id}`} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600" title="Verwijderen">
                        {busy === `delete-${item.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              )
            ))}
            {editing?.section === section.id && !editing.id && (
              <ItemForm
                campaignId={campaign.id}
                section={section.id}
                initial={EMPTY_ITEM}
                busy={busy === "save"}
                onSave={(form) => saveItem(section.id, form)}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
