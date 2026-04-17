"use client";

import { useState, useEffect } from "react";
import { X, ShoppingBag, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

function buildDefaultBilling(lead) {
  return {
    street: lead?.billing_street || "",
    house_number: lead?.billing_house_number || "",
    postal_code: lead?.billing_postal_code || "",
    city: lead?.billing_city || "",
    country: lead?.billing_country || "NL",
    // Order-updates e-mail (verzendbevestiging, status-updates)
    email: lead?.email || "",
    // Factuur e-mail (crediteuren / Moneybird / WCPDF)
    invoice_email: lead?.billing_email || "",
  };
}

function buildDefaultShipping(lead) {
  return {
    street: lead?.delivery_street || "",
    house_number: lead?.delivery_house_number || "",
    postal_code: lead?.delivery_postal_code || "",
    city: lead?.delivery_city || "",
    country: lead?.delivery_country || "NL",
  };
}

export default function QuoteToOrderModal({ quote, lead, lineItems = [], onClose, onSuccess }) {
  const [platform] = useState("woocommerce"); // Shopify is v2
  const [billing, setBilling] = useState(() => buildDefaultBilling(lead));
  const [sameAsBilling, setSameAsBilling] = useState(
    lead?.delivery_same_as_billing !== false
  );
  const [shipping, setShipping] = useState(() => buildDefaultShipping(lead));
  const [reference, setReference] = useState(lead?.customer_reference || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null); // { order_id, order_url, order_number }

  useEffect(() => {
    setBilling(buildDefaultBilling(lead));
    setShipping(buildDefaultShipping(lead));
    setSameAsBilling(lead?.delivery_same_as_billing !== false);
    setReference(lead?.customer_reference || "");
    setError("");
    setSuccess(null);
  }, [lead?.id, quote?.id]);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const body = {
        platform,
        billing,
        shipping: { ...shipping, same_as_billing: sameAsBilling },
        customer_reference: reference.trim() || null,
      };
      const res = await apiFetch(`/api/quotes/${quote.id}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || "Kon order niet aanmaken");
        return;
      }
      setSuccess({
        order_id: data.order_id,
        order_url: data.order_url,
        order_number: data.order_number,
      });
      onSuccess?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const total = lineItems.reduce((sum, i) => sum + Number(i.line_total || 0), 0);

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-brand-amber" />
            <h2 className="font-semibold text-lg">
              Offerte {quote?.quote_number} omzetten naar order
            </h2>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {success ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h3 className="font-semibold text-lg text-brand-black mb-1">
                Order aangemaakt
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                WooCommerce order <strong>#{success.order_number}</strong>
              </p>
              <a
                href={success.order_url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black"
              >
                Bekijk in WooCommerce
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}

              {/* Platform */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                  Webshop
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 px-3 py-2.5 border-2 border-brand-amber bg-brand-amber/10 rounded-xl cursor-pointer">
                    <input type="radio" checked readOnly className="accent-brand-amber" />
                    <span className="text-sm font-medium">Hiphot.nl (WooCommerce)</span>
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl opacity-50 cursor-not-allowed">
                    <input type="radio" disabled className="accent-gray-400" />
                    <span className="text-sm text-gray-500">Hiphot.eu (Shopify)</span>
                    <span className="ml-auto text-[10px] font-semibold text-gray-400 uppercase">Binnenkort</span>
                  </label>
                </div>
              </div>

              {/* Klantreferentie */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
                  Klantreferentie (PO/order ref)
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                  placeholder="bijv. PO-12345"
                />
              </div>

              {/* Factuuradres */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                  Factuuradres
                </label>
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="col-span-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="Straat"
                      value={billing.street}
                      onChange={(e) => setBilling({ ...billing, street: e.target.value })}
                    />
                    <input
                      className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="Nr."
                      value={billing.house_number}
                      onChange={(e) => setBilling({ ...billing, house_number: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="Postcode"
                      value={billing.postal_code}
                      onChange={(e) => setBilling({ ...billing, postal_code: e.target.value })}
                    />
                    <input
                      className="col-span-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="Plaats"
                      value={billing.city}
                      onChange={(e) => setBilling({ ...billing, city: e.target.value })}
                    />
                  </div>
                  <select
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
                    value={billing.country}
                    onChange={(e) => setBilling({ ...billing, country: e.target.value })}
                  >
                    <option value="NL">Nederland</option>
                    <option value="BE">België</option>
                    <option value="DE">Duitsland</option>
                    <option value="FR">Frankrijk</option>
                    <option value="LU">Luxemburg</option>
                  </select>
                </div>
              </div>

              {/* E-mailadressen — gescheiden: order updates vs factuur */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                  E-mailadressen
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <input
                      type="email"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="E-mail (order updates)"
                      value={billing.email}
                      onChange={(e) => setBilling({ ...billing, email: e.target.value })}
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                      Ontvangt orderbevestiging, verzendupdates, status-mails
                    </p>
                  </div>
                  <div>
                    <input
                      type="email"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                      placeholder="Factuur-e-mailadres (optioneel)"
                      value={billing.invoice_email}
                      onChange={(e) => setBilling({ ...billing, invoice_email: e.target.value })}
                    />
                    <p className="text-[10px] text-gray-400 mt-0.5 px-1">
                      Gaat naar crediteuren / Moneybird. Leeg = valt terug op bovenstaande.
                    </p>
                  </div>
                </div>
              </div>

              {/* Same-as toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => setSameAsBilling(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Leveradres is hetzelfde als factuuradres</span>
              </label>

              {/* Leveradres */}
              {!sameAsBilling && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                    Leveradres
                  </label>
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        className="col-span-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        placeholder="Straat"
                        value={shipping.street}
                        onChange={(e) => setShipping({ ...shipping, street: e.target.value })}
                      />
                      <input
                        className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        placeholder="Nr."
                        value={shipping.house_number}
                        onChange={(e) => setShipping({ ...shipping, house_number: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        placeholder="Postcode"
                        value={shipping.postal_code}
                        onChange={(e) => setShipping({ ...shipping, postal_code: e.target.value })}
                      />
                      <input
                        className="col-span-2 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
                        placeholder="Plaats"
                        value={shipping.city}
                        onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                      />
                    </div>
                    <select
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber bg-white"
                      value={shipping.country}
                      onChange={(e) => setShipping({ ...shipping, country: e.target.value })}
                    >
                      <option value="NL">Nederland</option>
                      <option value="BE">België</option>
                      <option value="DE">Duitsland</option>
                      <option value="FR">Frankrijk</option>
                      <option value="LU">Luxemburg</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Line items preview */}
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">
                  Regels ({lineItems.length})
                </label>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-xs text-gray-500">Product</th>
                        <th className="text-right px-3 py-2 font-medium text-xs text-gray-500 w-16">Aantal</th>
                        <th className="text-right px-3 py-2 font-medium text-xs text-gray-500 w-24">Totaal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((i) => (
                        <tr key={i.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-700">
                            <div>{i.name}</div>
                            {i.sku && <div className="text-[10px] text-gray-400">{i.sku}</div>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{i.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium">
                            €{Number(i.line_total || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                        <td className="px-3 py-2 text-gray-700" colSpan={2}>Subtotaal excl. BTW</td>
                        <td className="px-3 py-2 text-right text-gray-900">€{total.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-100 flex-shrink-0">
          {success ? (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium hover:bg-gray-50"
            >
              Sluiten
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={submitting}
                className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Bezig...
                  </>
                ) : (
                  <>
                    <ShoppingBag className="w-4 h-4" />
                    Maak order
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
