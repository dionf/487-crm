"use client";

import { useMemo } from "react";
import { TrendingUp, Package, Truck } from "lucide-react";
import { calculateOrderTotals } from "@/lib/hiphot-pricing";

function fmt(value) {
  return `\u20AC ${value.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value) {
  return `${value.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function Row({ label, value, className = "", sub = false }) {
  return (
    <div className={`flex justify-between items-center ${sub ? "pl-3 text-sm text-gray-500" : "text-sm"} ${className}`}>
      <span>{label}</span>
      <span className={`font-mono ${className}`}>{value}</span>
    </div>
  );
}

export default function MarginPanel({ items, settings, useFulfillment, onToggleFulfillment }) {
  const totals = useMemo(
    () => calculateOrderTotals(items || [], settings, useFulfillment),
    [items, settings, useFulfillment]
  );

  const gratisVerzending = totals.verzendkostenOntvangen === 0 && totals.brutoVerkoop > 0;
  const margeColor = totals.marge >= 0 ? "text-green-600" : "text-red-600";
  const margeOnderDoel = totals.brutoVerkoop > 0 && totals.margePercentageVerkoop < 40;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
      {/* Verkoop overzicht */}
      <div className="p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          Verkoop overzicht
        </h3>
        <Row label="Bruto verkoop" value={fmt(totals.brutoVerkoop)} />
        <Row
          label={
            totals.brutoVerkoop > 0 && totals.artikelKortingen > 0
              ? `Artikelkortingen (${fmtPct((totals.artikelKortingen / totals.brutoVerkoop) * 100)})`
              : "Artikelkortingen"
          }
          value={`- ${fmt(totals.artikelKortingen)}`}
          className="text-orange-600"
        />
        <Row label="Netto na korting" value={fmt(totals.nettoNaArtikelKorting)} className="font-medium" />
        <Row
          label={gratisVerzending ? "Gratis verzending" : "Verzendkosten ontvangen"}
          value={gratisVerzending ? fmt(0) : fmt(totals.verzendkostenOntvangen)}
          className={gratisVerzending ? "text-green-600" : ""}
        />
        <div className="border-t border-gray-100 pt-2 mt-2">
          <Row label="Netto verkoop" value={fmt(totals.nettoVerkoop)} className="font-semibold" />
        </div>
      </div>

      {/* Fulfillment kosten */}
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-500" />
            Fulfillment kosten
          </h3>
          <button
            type="button"
            role="switch"
            aria-checked={useFulfillment}
            onClick={onToggleFulfillment}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 ${
              useFulfillment ? "bg-purple-600" : "bg-gray-200"
            }`}
          >
            <span className="sr-only">Fulfillment meenemen in calculatie</span>
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                useFulfillment ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-gray-400 -mt-1 mb-2">
          {useFulfillment ? "Fulfillment meenemen in calculatie" : "Fulfillment uit — alleen inkoopprijs"}
        </p>
        <Row label="Verzendkosten (onze kant)" value={fmt(totals.verzendkostenInkoop)} />
        <Row label="Pick & pack vast" value={fmt(totals.pickpackVast)} sub />
        <Row label="Pick & pack variabel" value={fmt(totals.pickpackVariabel)} sub />
        <Row label="Inkoop artikelen" value={fmt(totals.inkoopTotaal)} />
        <div className="border-t border-gray-100 pt-2 mt-2">
          <Row label="Totale inkoopkosten" value={fmt(totals.totaleInkoopkosten)} className="font-semibold" />
        </div>
      </div>

      {/* Marge */}
      <div className="p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-green-500" />
          Marge
        </h3>
        <Row label="Marge" value={fmt(totals.marge)} className={`font-semibold ${margeColor}`} />
        <Row
          label="Marge % op verkoop"
          value={fmtPct(totals.margePercentageVerkoop)}
          className={margeOnderDoel ? "text-amber-600 font-semibold" : margeColor}
        />
        {margeOnderDoel && (
          <div className="mt-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium flex items-start gap-2">
            <span aria-hidden="true">⚠️</span>
            <span>Let op, je komt onder de gewenste marge (40%)</span>
          </div>
        )}
      </div>

      {/* Klant totaal */}
      <div className="p-4 space-y-2 bg-gray-50 rounded-b-lg">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
          <Truck className="w-4 h-4 text-gray-500" />
          Klant totaal
        </h3>
        <Row label="Subtotaal excl. BTW" value={fmt(totals.nettoVerkoop)} />
        <Row label="BTW (21%)" value={fmt(totals.btw)} />
        <div className="border-t border-gray-200 pt-2 mt-2">
          <Row label="Totaal incl. BTW" value={fmt(totals.totaalInclBtw)} className="font-bold text-base" />
        </div>
      </div>
    </div>
  );
}
