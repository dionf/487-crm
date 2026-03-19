"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import KanbanBoard from "@/components/KanbanBoard";
import StatsPanel from "@/components/StatsPanel";
import LeadForm from "@/components/LeadForm";
import CoworkBar from "@/components/CoworkBar";
import { Plus, RefreshCw, LayoutGrid, List } from "lucide-react";

export default function DashboardPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLeadForm, setShowLeadForm] = useState(false);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      console.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  async function handleStatusChange(leadId, newStatus) {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    );

    try {
      await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      fetchLeads(); // Rollback
    }
  }

  function handleCoworkResult(data) {
    if (data?.action) {
      fetchLeads();
    }
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Pipeline overzicht
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchLeads}
            className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-brand-black hover:border-brand-amber transition-colors"
            title="Vernieuwen"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowLeadForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nieuwe Lead
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsPanel leads={leads} />

      {/* Kanban */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <KanbanBoard leads={leads} onStatusChange={handleStatusChange} />
      )}

      {/* Lead Form Modal */}
      <LeadForm
        open={showLeadForm}
        onClose={() => setShowLeadForm(false)}
        onSaved={fetchLeads}
      />

      {/* Cowork */}
      <CoworkBar onResult={handleCoworkResult} />
    </AppShell>
  );
}
