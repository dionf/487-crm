"use client";

import { useMemo } from "react";
import { Trash2, GripVertical } from "lucide-react";
import { calculateLineTotals } from "@/lib/hiphot-pricing";

/**
 * Format a number as Euro string: € 12,50
 */
function euro(value) {
  const num = Number(value) || 0;
  return `\u20AC ${num.toFixed(2).replace(".", ",")}`;
}

/**
 * Format percentage: 25,0%
 */
function pct(value) {
  const num = Number(value) || 0;
  return `${num.toFixed(1).replace(".", ",")}%`;
}

export default function LineItemsTable({ items = [], onChange, onRemove }) {
  // Calculate totals for each line using the shared pricing lib
  const enrichedItems = useMemo(() => calculateLineTotals(items), [items]);

  // Footer totals
  const totals = useMemo(() => {
    let quantity = 0;
    let bruto = 0;
    let korting = 0;
    let netto = 0;

    enrichedItems.forEach((item) => {
      quantity += Number(item.quantity) || 0;
      bruto += item.bruto || 0;
      korting += item.korting || 0;
      netto += item.line_total || 0;
    });

    return { quantity, bruto, korting, netto };
  }, [enrichedItems]);

  function handleFieldChange(index, field, value) {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: value };
    });
    onChange(updated);
  }

  if (!items.length) {
    return (
      <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded">
        Geen regelitems. Voeg producten toe via de zoekbalk.
      </div>
    );
  }

  return (
    <div className="w-full">
      <table className="w-full text-xs border-collapse table-fixed">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] text-gray-500 uppercase tracking-wide">
            <th className="py-2 pl-1 pr-2 w-[34%]">Product</th>
            <th className="py-2 px-1 w-14 text-right">Aantal</th>
            <th className="py-2 px-1 w-20 text-right">Stuk</th>
            <th className="py-2 px-1 w-14 text-right">Kort %</th>
            <th className="py-2 px-1 w-24 text-right">Regel</th>
            <th className="py-2 px-1 w-28 text-right text-gray-400">Marge</th>
            <th className="py-2 px-1 w-7"></th>
          </tr>
        </thead>
        <tbody>
          {enrichedItems.map((item, index) => (
            <tr
              key={item.id || index}
              className="border-b border-gray-100 hover:bg-gray-50 group align-top"
            >
              {/* Product name + SKU + inkoop */}
              <td className="py-2 pl-1 pr-2">
                <div className="text-sm font-medium text-gray-800 truncate" title={item.name}>
                  {item.name || "Onbekend product"}
                </div>
                <div className="text-[10px] text-gray-400 flex items-center gap-2">
                  {item.sku && <span className="truncate">{item.sku}</span>}
                  <span>Inkoop: {euro(item.inkoop_total)}</span>
                </div>
              </td>

              {/* Quantity */}
              <td className="py-2 px-1">
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) =>
                    handleFieldChange(
                      index,
                      "quantity",
                      Math.max(1, parseInt(e.target.value) || 1)
                    )
                  }
                  className="w-full text-right text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-brand-amber"
                />
              </td>

              {/* Unit price */}
              <td className="py-2 px-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.unit_price}
                  onChange={(e) =>
                    handleFieldChange(
                      index,
                      "unit_price",
                      parseFloat(e.target.value) || 0
                    )
                  }
                  className="w-full text-right text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-brand-amber"
                />
              </td>

              {/* Discount % */}
              <td className="py-2 px-1">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={item.discount_pct}
                  onChange={(e) =>
                    handleFieldChange(
                      index,
                      "discount_pct",
                      Math.min(100, Math.max(0, parseFloat(e.target.value) || 0))
                    )
                  }
                  className="w-full text-right text-xs border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-brand-amber"
                />
              </td>

              {/* Line total */}
              <td className="py-2 px-1 text-right text-sm font-semibold text-gray-800">
                {euro(item.line_total)}
              </td>

              {/* Marge */}
              <td className="py-2 px-1 text-right">
                <div
                  className={`text-xs font-semibold ${
                    (item.marge || 0) >= 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {euro(item.marge)}
                </div>
                <div className="text-[10px] text-gray-400">{pct(item.marge_pct)}</div>
              </td>

              {/* Delete */}
              <td className="py-2 px-1 text-center">
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                  title="Verwijder regel"
                >
                  <Trash2 size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>

        {/* Totals footer */}
        <tfoot>
          <tr className="border-t-2 border-gray-300 font-semibold text-sm">
            <td className="py-2 pl-1 pr-2 text-gray-600">
              Totaal
              <div className="text-[10px] font-normal text-gray-400">
                Bruto {euro(totals.bruto)} · Korting {euro(totals.korting)}
              </div>
            </td>
            <td className="py-2 px-1 text-right text-gray-800">{totals.quantity}</td>
            <td className="py-2 px-1" />
            <td className="py-2 px-1" />
            <td className="py-2 px-1 text-right text-gray-800">{euro(totals.netto)}</td>
            <td className="py-2 px-1" />
            <td className="py-2 px-1" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
