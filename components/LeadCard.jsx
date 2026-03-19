"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, FileText, MessageSquare, CircleDot } from "lucide-react";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { SERVICE_TYPES } from "@/lib/constants";

export default function LeadCard({ lead, isDragging }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const serviceLabel = SERVICE_TYPES.find(
    (s) => s.id === lead.service_type
  )?.label;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-gray-100 rounded-2xl p-3 hover:shadow-md transition-shadow cursor-pointer group"
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 p-0.5 rounded text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        <Link href={`/leads/${lead.id}`} className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-brand-black truncate">
            {lead.company_name}
          </p>
          <p className="text-xs text-gray-500 truncate">{lead.contact_person}</p>

          <div className="flex items-center gap-2 mt-2">
            {serviceLabel && (
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-pill bg-brand-light-beige text-brand-orange">
                {serviceLabel}
              </span>
            )}
            {lead.estimated_value && (
              <span className="text-xs font-medium text-brand-dark-gray">
                {formatCurrency(lead.estimated_value)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2 text-gray-400">
            {lead.quote_count > 0 && (
              <span className="flex items-center gap-1 text-[10px]">
                <FileText className="w-3 h-3" />
                {lead.quote_count}
              </span>
            )}
            {lead.note_count > 0 && (
              <span className="flex items-center gap-1 text-[10px]">
                <MessageSquare className="w-3 h-3" />
                {lead.note_count}
              </span>
            )}
            {lead.open_todo_count > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-red-500 font-semibold">
                <CircleDot className="w-3 h-3" />
                {lead.open_todo_count}
              </span>
            )}
            <span className="ml-auto text-[10px]">
              {formatRelativeTime(lead.updated_at)}
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
