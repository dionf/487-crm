"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import KanbanColumn from "./KanbanColumn";
import LeadCard from "./LeadCard";
import { LEAD_STATUSES } from "@/lib/constants";

export default function KanbanBoard({ leads, onStatusChange, statuses }) {
  const [activeId, setActiveId] = useState(null);
  const pipelineStatuses = statuses || LEAD_STATUSES;

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
      <div className="flex gap-3 overflow-x-auto pb-4">
        {pipelineStatuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            leads={leads.filter((l) => l.status === status.id)}
          />
        ))}
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
