"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import LeadCard from "./LeadCard";
import { STATUS_COLORS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";

export default function KanbanColumn({ status, leads }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const colors = STATUS_COLORS[status.id];
  const totalValue = leads.reduce(
    (sum, l) => sum + (parseFloat(l.estimated_value) || 0),
    0
  );

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[260px] w-[260px] rounded-2xl transition-colors ${
        isOver ? "drop-active border-2 border-dashed" : "border-2 border-transparent"
      }`}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
          <span className="text-xs font-semibold text-brand-dark-gray uppercase tracking-wide">
            {status.label}
          </span>
          <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-pill">
            {leads.length}
          </span>
        </div>
        {totalValue > 0 && (
          <span className="text-[10px] font-medium text-gray-400">
            {formatCurrency(totalValue)}
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 px-1.5 pb-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        <SortableContext
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="text-center py-8 text-xs text-gray-300">
            Geen leads
          </div>
        )}
      </div>
    </div>
  );
}
