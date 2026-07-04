"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Save, Send, Eye, Globe, ChevronDown, Plus, FileText } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { LANGUAGES } from "@/lib/translations/quote";
import { calculateLineTotals, calculateOrderTotals } from "@/lib/hiphot-pricing";
import ProductSelector from "@/components/hiphot/ProductSelector";
import LineItemsTable from "@/components/hiphot/LineItemsTable";
import MarginPanel from "@/components/hiphot/MarginPanel";

export default function HipHotQuoteBuilder({ open, onClose, lead, onSaved, editQuoteId = null, onPublishedEmail }) {
  const { user } = useOrg();
  const [step, setStep] = useState("edit"); // edit | preview | published
  const [loading, setLoading] = useState(false);
  const [publishedQuote, setPublishedQuote] = useState(null);
  const [error, setError] = useState("");
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [addedFlash, setAddedFlash] = useState(0);

  // Quote data
  const [language, setLanguage] = useState(lead?.language || "nl");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [remarksHtml, setRemarksHtml] = useState("");
  const [items, setItems] = useState([]);
  const [useFulfillment, setUseFulfillment] = useState(true);
  const [editingId, setEditingId] = useState(null);

  // Settings & branch text
  const [settings, setSettings] = useState(null);
  const [branchText, setBranchText] = useState(null);
  const [branchTexts, setBranchTexts] = useState([]);

  // Preview HTML
  const [previewHtml, setPreviewHtml] = useState("");

  // Track whether modal was already open (prevent re-reset on lead changes)
  const prevOpenRef = useRef(false);

  // Load settings + branch texts on open
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }

    const freshOpen = !prevOpenRef.current;
    prevOpenRef.current = true;

    // Only reset form when modal freshly opens, not on subsequent re-renders
    if (!freshOpen) return;

    // Reset form — sender info from logged-in user (klantinfo komt rechtstreeks van lead)
    setContactName(user?.name || "");
    setContactEmail(user?.email || "");
    setContactPhone(user?.phone || "");
    setLanguage(lead?.language || "nl");
    setItems([]);
    setRemarksHtml("");
    setStep("edit");
    setError("");
    setUseFulfillment(true);
    setEditingId(editQuoteId || null);

    // Fetch settings
    apiFetch("/api/hiphot/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => {});

    // Fetch branch texts
    apiFetch("/api/hiphot/branch-texts")
      .then((r) => r.json())
      .then((d) => {
        setBranchTexts(d.texts || []);
        // Auto-select based on lead industry + language
        if (lead?.industry) {
          const match =
            d.texts?.find((t) => t.branch_key === lead.industry && t.language === (lead?.language || "nl")) ||
            d.texts?.find((t) => t.branch_key === lead.industry && t.language === "nl");
          if (match) setBranchText(match);
        }
      })
      .catch(() => {});

    // Load existing quote when editing
    if (editQuoteId) {
      (async () => {
        try {
          const [qRes, iRes] = await Promise.all([
            apiFetch(`/api/quotes/${editQuoteId}`),
            apiFetch(`/api/hiphot/quote-items?quote_id=${editQuoteId}`),
          ]);
          const { quote } = await qRes.json();
          const { items: existingItems } = await iRes.json();
          if (quote) {
            setLanguage(quote.language || "nl");
            setContactName(quote.contact_name || user?.name || "");
            setContactEmail(quote.contact_email || user?.email || "");
            setContactPhone(quote.contact_phone || "");
            setRemarksHtml(quote.remarks_html || "");
            setUseFulfillment(quote.margin_data?.useFulfillment ?? true);
          }
          if (existingItems?.length) {
            setItems(
              existingItems.map((it) => ({
                id: crypto.randomUUID(),
                article_id: it.article_id,
                wc_product_id: it.wc_product_id,
                name: it.name,
                sku: it.sku || "",
                description: it.description || "",
                quantity: Number(it.quantity) || 1,
                unit_price: Number(it.unit_price) || 0,
                discount_pct: Number(it.discount_pct) || 0,
                inkoop_price: Number(it.inkoop_price) || 0,
                sort_order: it.sort_order || 0,
              }))
            );
          }
        } catch (e) {
          setError("Bestaande offerte kon niet worden geladen");
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editQuoteId]);

  // Update branch text when language changes
  useEffect(() => {
    if (!lead?.industry || branchTexts.length === 0) return;
    const match =
      branchTexts.find((t) => t.branch_key === lead.industry && t.language === language) ||
      branchTexts.find((t) => t.branch_key === lead.industry && t.language === "nl");
    setBranchText(match || null);
  }, [language, lead?.industry, branchTexts]);

  function handleAddProduct(product) {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        article_id: product.id,
        wc_product_id: product.wc_product_id,
        name: product.name,
        sku: product.sku || "",
        description: "",
        quantity: 1,
        unit_price: Number(product.verkoop_price) || 0,
        discount_pct: 0,
        inkoop_price: Number(product.inkoop_price) || 0,
        sort_order: prev.length,
      },
    ]);
    // Houd het paneel open en geef korte feedback
    setAddedFlash((c) => c + 1);
  }

  function handleRemoveItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Computed totals — landcode bepaalt verzendtarief (NL/BE €3,99, overige EU €4,95)
  const shippingCountry = lead?.delivery_country || lead?.billing_country || "NL";
  const enrichedItems = calculateLineTotals(items);
  const orderTotals = calculateOrderTotals(items, settings || {}, useFulfillment, shippingCountry);

  async function handleSave(publish = false) {
    if (items.length === 0) {
      setError("Voeg minimaal één product toe");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const payload = {
        lead_id: lead.id,
        amount_excl_vat: orderTotals.nettoVerkoop,
        vat_percentage: 21,
        description: items.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        quote_type: "hiphot",
        remarks_html: remarksHtml || null,
        shipping_cost: orderTotals.verzendkostenOntvangen,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        language,
        margin_data: {
          useFulfillment,
          ...orderTotals,
        },
      };

      let quote;
      if (editingId) {
        // Update existing quote
        const r = await apiFetch(`/api/quotes/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.error || "Fout bij bijwerken");
        }
        const j = await r.json();
        quote = j.quote;
      } else {
        const quoteRes = await apiFetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!quoteRes.ok) {
          const err = await quoteRes.json();
          throw new Error(err.error || "Fout bij opslaan");
        }
        const j = await quoteRes.json();
        quote = j.quote;
      }

      // Save line items — replace all on edit
      const lineItemsData = enrichedItems
        .filter((i) => i.quantity > 0)
        .map((item, idx) => ({
          quote_id: quote.id,
          article_id: item.article_id || null,
          wc_product_id: item.wc_product_id || null,
          name: item.name,
          sku: item.sku || null,
          description: item.description || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_pct: item.discount_pct || 0,
          line_total: item.line_total,
          inkoop_price: item.inkoop_price || null,
          sort_order: idx,
        }));

      await apiFetch("/api/hiphot/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lineItemsData, replace_for_quote_id: quote.id }),
      });

      // Publish if requested OR re-generate HTML if quote was already published
      const wasPublish = publish && !quote.public_hash;
      if (publish || quote.public_hash) {
        const pubRes = await apiFetch(`/api/quotes/${quote.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generate_hiphot_html: true,
            language,
            branch_text_id: branchText?.id || null,
            keep_hash: !!quote.public_hash,
          }),
        });
        const pubData = await pubRes.json();

        // After first publish: show "want to email?" prompt
        if (wasPublish && pubData.public_url) {
          setPublishedQuote({
            id: quote.id,
            quote_number: quote.quote_number,
            public_hash: pubData.public_url.split("/offerte/")[1],
            amount_excl_vat: orderTotals.nettoVerkoop,
          });
          onSaved?.();
          setStep("published");
          setLoading(false);
          return;
        }
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/hiphot/quote-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead,
          items: enrichedItems.filter((i) => i.quantity > 0),
          totals: orderTotals,
          branchText,
          language,
          remarksHtml,
          contactName,
          contactEmail,
          contactPhone,
        }),
      });
      const { html } = await res.json();
      setPreviewHtml(html);
      setStep("preview");
    } catch {
      setError("Preview kon niet worden gegenereerd");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="w-full max-w-5xl bg-white h-full overflow-y-auto shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-brand-orange" />
            <div>
              <h2 className="font-semibold text-lg">{editingId ? "Offerte bewerken" : "HipHot Offerte"}</h2>
              <p className="text-xs text-gray-500">{lead?.company_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                onClick={() => setStep("edit")}
                className="px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50"
              >
                Terug naar bewerken
              </button>
            )}
            {step === "edit" && (
              <>
                <button
                  onClick={handlePreview}
                  disabled={loading || items.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={() => handleSave(false)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40"
                >
                  <Save className="w-4 h-4" />
                  Opslaan
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-amber hover:bg-brand-amber-hover rounded-pill font-semibold text-brand-black disabled:opacity-40"
                >
                  <Send className="w-4 h-4" />
                  Publiceren
                </button>
              </>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl">{error}</div>
        )}

        {step === "published" ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-brand-black mb-2">Offerte gepubliceerd!</h2>
            <p className="text-sm text-gray-500 mb-8">
              {publishedQuote?.quote_number} is nu beschikbaar via de publieke link.
              Wil je direct een e-mail versturen naar de klant?
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => {
                  onClose();
                }}
                className="px-5 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Later
              </button>
              <button
                onClick={() => {
                  onClose();
                  onPublishedEmail?.(publishedQuote);
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black"
              >
                <Send className="w-4 h-4" />
                E-mail versturen
              </button>
            </div>
          </div>
        ) : step === "preview" ? (
          <div className="p-6">
            <iframe
              srcDoc={previewHtml}
              className="w-full h-[80vh] border border-gray-200 rounded-xl"
              title="Quote Preview"
            />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="space-y-6">
              {/* Client */}
              <div className="bg-white border border-gray-100 rounded-card p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Klantgegevens
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Bedrijf</label>
                    <p className="text-sm font-medium">{lead?.company_name || "-"}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Contactpersoon</label>
                    <p className="text-sm font-medium">
                      {lead?.contact_first_name && lead?.contact_last_name
                        ? `${lead.contact_first_name} ${lead.contact_last_name}`
                        : lead?.contact_person || "-"}
                    </p>
                    {lead?.contact_function && (
                      <p className="text-xs text-gray-400">{lead.contact_function}</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Email</label>
                    <p className="text-sm">{lead?.email || "-"}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Telefoon</label>
                    <p className="text-sm">{lead?.phone || "-"}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Taal</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Sender / Afzender */}
              <div className="bg-white border border-gray-100 rounded-card p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Afzender
                </h3>
                <p className="text-xs text-gray-400 mb-3">
                  Wordt getoond als &quot;Prijsopgave aangemaakt door&quot; en in het contactblok.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Naam</label>
                    <input
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Email</label>
                    <input
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Telefoon</label>
                    <input
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                    />
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="bg-white border border-gray-100 rounded-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Producten
                  </h3>
                  <button
                    onClick={() => setShowProductSelector(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-amber/10 text-brand-orange rounded-pill hover:bg-brand-amber/20"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Product toevoegen
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    <p>Nog geen producten toegevoegd</p>
                    <button
                      onClick={() => setShowProductSelector(true)}
                      className="mt-2 text-brand-orange hover:underline text-sm"
                    >
                      Voeg je eerste product toe
                    </button>
                  </div>
                ) : (
                  <LineItemsTable
                    items={enrichedItems}
                    onChange={setItems}
                    onRemove={handleRemoveItem}
                  />
                )}
              </div>

              {/* Branch text */}
              {branchText && (
                <div className="bg-amber-50 border border-amber-100 rounded-card p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Branchetekst — {branchText.branch_key} (deze tekst komt in de offerte)
                    {branchText.language !== language && (
                      <span className="ml-2 text-amber-600 normal-case">(Fallback: {branchText.language})</span>
                    )}
                  </h3>
                  {branchText.title && (
                    <p className="font-semibold text-sm mb-1">{branchText.title}</p>
                  )}
                  <div
                    className="prose prose-sm max-w-none text-sm text-gray-600 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: branchText.body || "" }}
                  />
                </div>
              )}

              {/* Remarks */}
              <div className="bg-white border border-gray-100 rounded-card p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Opmerkingen (optioneel)
                </h3>
                <textarea
                  value={remarksHtml}
                  onChange={(e) => setRemarksHtml(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber resize-none"
                  placeholder="Eventuele opmerkingen op de offerte..."
                />
              </div>
            </div>

            {/* Margin panel onder de items */}
            <MarginPanel
              items={items}
              settings={settings || {}}
              useFulfillment={useFulfillment}
              onToggleFulfillment={() => setUseFulfillment(!useFulfillment)}
            />
          </div>
        )}

        {/* Product Selector Modal */}
        {showProductSelector && (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold">Producten toevoegen</h2>
                  {addedFlash > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-green-50 text-green-700">
                      {addedFlash} toegevoegd
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setShowProductSelector(false); setAddedFlash(0); }}
                  className="px-3 py-1.5 text-sm font-semibold bg-brand-amber hover:bg-brand-amber-hover text-brand-black rounded-pill"
                >
                  Klaar
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                <ProductSelector onAddProduct={handleAddProduct} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
