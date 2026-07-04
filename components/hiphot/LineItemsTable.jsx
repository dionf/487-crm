"use client";

import { useMemo } from "react";
import { Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { calculateLineTotals, getShippingCost } from "@/lib/hiphot-pricing";

/**
 * Format a number as Euro string: € 12,50
 */
function euro(value) {
  const num = Number(value) || 0;
  return `€ ${num.toFixed(2).replace(".", ",")}`;
}

/**
 * Format percentage: 25,0%
 */
function pct(value) {
  const num = Number(value) || 0;
  return `${num.toFixed(1).replace(".", ",")}%`;
}

function SortableRow({ item, index, onFieldChange, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-b border-gray-100 hover:bg-gray-50 group align-top"
    >
      {/* Drag handle */}
      <td className="py-2 px-1 text-center">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 touch-none"
          title="Sleep om volgorde te wijzigen"
          aria-label="Sleep om volgorde te wijzigen"
        >
          <GripVertical size={14} />
        </button>
      </td>

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
            onFieldChange(
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
            onFieldChange(index, "unit_price", parseFloat(e.target.value) || 0)
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
            onFieldChange(
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
  );
}

export default function LineItemsTable({ items = [], onChange, onRemove, country = "NL" }) {
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

    // Verzendkosten voor klant — NL/BE €3,99, overige EU €4,95, gratis vanaf €199
    const shipping = getShippingCost(country, netto);
    const totaalMetVerzending = netto + shipping;
    return { quantity, bruto, korting, netto, shipping, totaalMetVerzending };
  }, [enrichedItems, country]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sortableIds = useMemo(() => items.map((i) => i.id), [items]);

  function handleFieldChange(index, field, value) {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: value };
    });
    onChange(updated);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(items, oldIndex, newIndex));
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <table className="w-full text-xs border-collapse table-fixed">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[10px] text-gray-500 uppercase tracking-wide">
              <th className="py-2 px-1 w-6"></th>
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
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {enrichedItems.map((item, index) => (
                <SortableRow
                  key={item.id || index}
                  item={item}
                  index={index}
                  onFieldChange={handleFieldChange}
                  onRemove={onRemove}
                />
              ))}
            </SortableContext>
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-semibold text-sm">
              <td className="py-2 px-1" />
              <td className="py-2 pl-1 pr-2 text-gray-600">
                Subtotaal
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
            <tr className="text-xs text-gray-500">
              <td className="py-1 px-1" />
              <td className="py-1 pl-1 pr-2">
                Verzending{" "}
                <span className="text-[10px] text-gray-400">
                  ({country === "NL" || country === "BE" ? "NL/BE" : "EU"}
                  {totals.shipping === 0 ? " · vanaf €199 gratis" : ""})
                </span>
              </td>
              <td className="py-1 px-1" />
              <td className="py-1 px-1" />
              <td className="py-1 px-1" />
              <td className="py-1 px-1 text-right">
                {totals.shipping === 0 ? <em className="text-gray-400">Gratis</em> : euro(totals.shipping)}
              </td>
              <td className="py-1 px-1" />
              <td className="py-1 px-1" />
            </tr>
            <tr className="border-t border-gray-200 font-semibold text-sm">
              <td className="py-2 px-1" />
              <td className="py-2 pl-1 pr-2 text-gray-800">Totaal excl. BTW</td>
              <td className="py-2 px-1" />
              <td className="py-2 px-1" />
              <td className="py-2 px-1" />
              <td className="py-2 px-1 text-right text-gray-900">{euro(totals.totaalMetVerzending)}</td>
              <td className="py-2 px-1" />
              <td className="py-2 px-1" />
            </tr>
          </tfoot>
        </table>
      </DndContext>
    </div>
  );
}
