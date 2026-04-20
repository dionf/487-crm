"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import KanbanBoard from "@/components/KanbanBoard";
import StatsPanel from "@/components/StatsPanel";
import LeadForm from "@/components/LeadForm";
import CoworkBar from "@/components/CoworkBar";
import { Plus, RefreshCw, LayoutGrid, List, Phone, PhoneForwarded, PhoneOff, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { getLeadStatuses } from "@/lib/constants";

const CALL_FILTERS = [
  { id: null, label: "Alle", icon: null },
  { id: "nieuw", label: "Nieuw", icon: Phone, color: "text-green-600 bg-green-50 border-green-200" },
  { id: "terugbellen", label: "Terugbellen", icon: PhoneForwarded, color: "text-amber-700 bg-amber-50 border-amber-200" },
  { id: "geen_gehoor", label: "Geen gehoor", icon: PhoneOff, color: "text-orange-700 bg-orange-50 border-orange-200" },
];

export default function DashboardPage() {
  const { tenant, organization } = useOrg();
  const pipelineStatuses = getLeadStatuses(tenant);
  const isHipHot = tenant === "hiphot";
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [callFilter, setCallFilter] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshInfo, setRefreshInfo] = useState(null);

  const fetchLeads = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (callFilter) params.set("call_filter", callFilter);
      const url = `/api/leads${params.toString() ? `?${params}` : ""}`;
      const res = await apiFetch(url);
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      console.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  }, [callFilter]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshInfo(null);
    try {
      const pollPromise = apiFetch("/api/poll-inbox")
        .then((r) => r.json())
        .catch((e) => ({ error: e.message }));
      const reloadPromise = fetchLeads();
      const [pollResult] = await Promise.all([pollPromise, reloadPromise]);
      const mb = (pollResult?.mailboxes || [])[0] || {};
      const results = mb.results || [];
      const newLeads = results.filter((r) => r.status === "success").length;
      const matched = results.filter((r) => r.status === "matched_existing").length;
      setRefreshInfo({
        new_leads: newLeads,
        matched,
        error: pollResult?.error || mb.error || null,
        detail: pollResult?.detail || mb.detail || null,
      });
      setTimeout(() => setRefreshInfo(null), 6000);
    } finally {
      setRefreshing(false);
    }
  }

  // Only fetch after mount (client-side) to ensure localStorage session is available
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (mounted) fetchLeads();
  }, [mounted, fetchLeads]);

  async function handleStatusChange(leadId, newStatus) {
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
    );

    try {
      await apiFetch(`/api/leads/${leadId}`, {
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
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Pipeline overzicht
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 rounded-xl border border-gray-200 text-gray-400 hover:text-brand-black hover:border-brand-amber transition-colors disabled:opacity-50"
            title="Vernieuwen — haalt ook nieuwe e-mails op"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
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
      {refreshInfo && (
        <div
          className={`mb-4 px-3 py-2 rounded-xl text-sm ${
            refreshInfo.error
              ? "bg-red-50 text-red-700 border border-red-100"
              : refreshInfo.new_leads === 0 && refreshInfo.matched === 0
              ? "bg-gray-50 text-gray-600 border border-gray-100"
              : "bg-green-50 text-green-700 border border-green-100"
          }`}
        >
          {refreshInfo.error
            ? `⚠️ IMAP-fout: ${refreshInfo.detail || refreshInfo.error}`
            : refreshInfo.new_leads === 0 && refreshInfo.matched === 0
            ? "Geen nieuwe e-mails gevonden."
            : `✉️ ${refreshInfo.new_leads} nieuwe lead${refreshInfo.new_leads === 1 ? "" : "s"} via e-mail${refreshInfo.matched ? ` · ${refreshInfo.matched} aan bestaande gekoppeld` : ""}.`}
        </div>
      )}

      {/* Stats */}
      <StatsPanel leads={leads} />

      {/* HipHot call filter tabs */}
      {isHipHot && (
        <div className="flex items-center gap-2 mb-4">
          {CALL_FILTERS.map((f) => {
            const active = callFilter === f.id;
            const Icon = f.icon;
            return (
              <button
                key={f.id || "all"}
                onClick={() => { setCallFilter(f.id); setLoading(true); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold border transition-colors ${
                  active
                    ? f.color || "text-brand-black bg-brand-light-beige border-brand-amber"
                    : "text-gray-500 bg-white border-gray-200 hover:border-gray-300"
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Kanban */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <KanbanBoard leads={leads} onStatusChange={handleStatusChange} statuses={pipelineStatuses} />
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
