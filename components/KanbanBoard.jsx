"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import KanbanColumn from "./KanbanColumn";
import LeadCard from "./LeadCard";
import { LEAD_STATUSES } from "@/lib/constants";

const SCROLL_STEP = 320; // ~1 kolombreedte

export default function KanbanBoard({ leads, onStatusChange, statuses }) {
  const [activeId, setActiveId] = useState(null);
  const pipelineStatuses = statuses || LEAD_STATUSES;

  // Horizontal scroll state
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, pipelineStatuses.length, leads.length]);

  function scrollBy(dir) {
    scrollRef.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: "smooth" });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const activeLead = activeId
    ? leads.find((l) => l.id === activeId)
    : null;

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const leadId = active.id;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    let targetStatus = over.id;
    if (!pipelineStatuses.find((s) => s.id === over.id)) {
      const targetLead = leads.find((l) => l.id === over.id);
      if (targetLead) {
        targetStatus = targetLead.status;
      } else {
        return;
      }
    }

    if (lead.status !== targetStatus) {
      onStatusChange(leadId, targetStatus);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="relative">
        {/* Scroll knoppen — alleen zichtbaar als er echt te scrollen valt */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll naar links"
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 w-9 h-9 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:text-brand-black hover:border-brand-amber transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll naar rechts"
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-9 h-9 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:text-brand-black hover:border-brand-amber transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-4 scroll-smooth"
        >
          {pipelineStatuses.map((status) => (
            <KanbanColumn
              key={status.id}
              status={status}
              leads={leads.filter((l) => l.status === status.id)}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeLead ? (
          <div className="w-[240px]">
            <LeadCard lead={activeLead} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
