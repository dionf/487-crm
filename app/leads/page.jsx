"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import LeadForm from "@/components/LeadForm";
import CoworkBar from "@/components/CoworkBar";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { SERVICE_TYPES, getLeadStatuses } from "@/lib/constants";
import { useOrg } from "@/lib/org-context";
import { apiFetch } from "@/lib/api";
import {
  Plus,
  Search,
  FileText,
  MessageSquare,
  CircleDot,
  Phone,
  ArrowRight,
  Users,
  Shuffle,
  Trash2,
} from "lucide-react";

const CALL_OUTCOME_LABELS = {
  voorstel_mailen: { label: "Voorstel mailen", color: "bg-blue-100 text-blue-700" },
  terugbellen_5_dagen: { label: "Terugbellen 5d", color: "bg-amber-100 text-amber-700" },
  geen_gehoor_terugbellen: { label: "Geen gehoor", color: "bg-orange-100 text-orange-700" },
  niet_geinteresseerd: { label: "Niet geïnteresseerd", color: "bg-red-100 text-red-700" },
  vraag_opvolgen_collega: { label: "Collega", color: "bg-purple-100 text-purple-700" },
};

export default function LeadsPage() {
  const { tenant, user, isAdmin } = useOrg();
  const isHipHot = tenant === "hiphot";
  const statuses = getLeadStatuses(tenant);

  const [leads, setLeads] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState(new Set());
  const [assigning, setAssigning] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignAgents, setAssignAgents] = useState(new Set());

  const fetchLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (serviceFilter) params.set("service_type", serviceFilter);
    if (agentFilter) params.set("assigned_to", agentFilter);

    try {
      const res = await apiFetch(`/api/leads?${params}`);
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      console.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, serviceFilter, agentFilter]);

  useEffect(() => {
    const timeout = setTimeout(fetchLeads, 300);
    return () => clearTimeout(timeout);
  }, [fetchLeads]);

  // Fetch agents for filter/assign
  useEffect(() => {
    if (isAdmin) {
      apiFetch("/api/admin/users")
        .then((r) => r.json())
        .then((d) => setAgents(d.users || []))
        .catch(() => {});
    }
  }, [isAdmin]);

  // Find next uncalled lead
  function getNextToBell() {
    return leads.find((l) =>
      !l.call_outcome &&
      l.status !== "offerte_verloren" &&
      l.status !== "offerte_gewonnen" &&
      (!l.assigned_to || l.assigned_to === user?.id)
    );
  }

  // Bulk assign
  async function handleBulkAssign(userId) {
    setAssigning(true);
    await apiFetch("/api/admin/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_ids: [...selectedLeads], user_id: userId }),
    });
    setSelectedLeads(new Set());
    setAssigning(false);
    fetchLeads();
  }

  async function handleAutoAssign() {
    setAssigning(true);
    const agentIds = [...assignAgents];
    await apiFetch("/api/admin/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "auto", agent_ids: agentIds.length ? agentIds : undefined }),
    });
    setAssigning(false);
    setShowAssignModal(false);
    setAssignAgents(new Set());
    fetchLeads();
  }

  function toggleAssignAgent(id) {
    const next = new Set(assignAgents);
    next.has(id) ? next.delete(id) : next.add(id);
    setAssignAgents(next);
  }

  async function handleBulkDelete() {
    const count = selectedLeads.size;
    if (!confirm(`Weet je zeker dat je ${count} lead${count > 1 ? "s" : ""} wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    for (const id of selectedLeads) {
      await apiFetch(`/api/leads/${id}`, { method: "DELETE" });
    }
    setSelectedLeads(new Set());
    fetchLeads();
  }

  function toggleSelect(id) {
    const next = new Set(selectedLeads);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedLeads(next);
  }

  function toggleSelectAll() {
    if (selectedLeads.size === leads.length) {
      setSelectedLeads(new Set());
    } else {
      setSelectedLeads(new Set(leads.map((l) => l.id)));
    }
  }

  const nextLead = isHipHot ? getNextToBell() : null;


  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">
            {isHipHot ? "Bellijst" : "Leads"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {leads.length} leads gevonden
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isHipHot && nextLead && (
            <Link
              href={`/leads/${nextLead.id}`}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 rounded-pill text-sm font-semibold text-white transition-colors"
            >
              <Phone className="w-4 h-4" />
              Volgende bellen
            </Link>
          )}
          {isAdmin && isHipHot && (
            <button
              onClick={() => setShowAssignModal(true)}
              disabled={assigning}
              className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:border-brand-amber transition-colors disabled:opacity-50"
            >
              <Shuffle className="w-4 h-4" />
              Auto-verdelen
            </button>
          )}
          <button
            onClick={() => setShowLeadForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nieuwe Lead
          </button>
        </div>
      </div>

      {/* Bulk assign bar */}
      {selectedLeads.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-brand-amber/10 rounded-xl">
          <span className="text-sm font-medium">{selectedLeads.size} geselecteerd</span>
          {isAdmin && (
            <>
              <ArrowRight className="w-4 h-4 text-gray-400" />
              <select
                onChange={(e) => e.target.value && handleBulkAssign(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm bg-white"
                defaultValue=""
              >
                <option value="">Toewijzen aan...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </>
          )}
          <button
            onClick={handleBulkDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors ml-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Verwijderen
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Zoek op bedrijf of contactpersoon..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
        >
          <option value="">Alle statussen</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        {!isHipHot && (
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
          >
            <option value="">Alle services</option>
            {SERVICE_TYPES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}

        {isAdmin && agents.length > 0 && (
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
          >
            <option value="">Alle agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedLeads.size === leads.length && leads.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Bedrijf</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                {isHipHot ? (
                  <>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Plaats</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Branche</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Telefoon</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Uitkomst</th>
                  </>
                ) : (
                  <>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Service</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Waarde</th>
                    <th className="text-center text-xs font-semibold text-gray-500 uppercase px-4 py-3">Info</th>
                  </>
                )}
                <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Bijgewerkt</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                    Geen leads gevonden
                  </td>
                </tr>
              ) : (
                leads.map((lead) => {
                  const outcomeInfo = CALL_OUTCOME_LABELS[lead.call_outcome];
                  return (
                    <tr key={lead.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedLeads.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="block">
                          <p className="font-semibold text-sm text-brand-black">{lead.company_name}</p>
                          <p className="text-xs text-gray-500">{lead.contact_person || lead.email}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      {isHipHot ? (
                        <>
                          <td className="px-4 py-3 text-sm text-gray-600">{lead.city || "—"}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{lead.industry || "—"}</td>
                          <td className="px-4 py-3">
                            {lead.phone ? (
                              <a href={`tel:${lead.phone}`} className="text-sm text-brand-orange hover:underline flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {lead.phone}
                              </a>
                            ) : (
                              <span className="text-sm text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {outcomeInfo ? (
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill ${outcomeInfo.color}`}>
                                {outcomeInfo.label}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">Nog niet gebeld</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-600">
                              {SERVICE_TYPES.find((s) => s.id === lead.service_type)?.label || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-medium">{formatCurrency(lead.estimated_value)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-3 text-gray-400">
                              {lead.quote_count > 0 && (
                                <span className="flex items-center gap-1 text-xs">
                                  <FileText className="w-3.5 h-3.5" />{lead.quote_count}
                                </span>
                              )}
                              {lead.note_count > 0 && (
                                <span className="flex items-center gap-1 text-xs">
                                  <MessageSquare className="w-3.5 h-3.5" />{lead.note_count}
                                </span>
                              )}
                              {lead.open_todo_count > 0 && (
                                <span className="flex items-center gap-1 text-xs text-red-500 font-semibold">
                                  <CircleDot className="w-3.5 h-3.5" />{lead.open_todo_count}
                                </span>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-gray-400">{formatRelativeTime(lead.updated_at)}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeadForm open={showLeadForm} onClose={() => setShowLeadForm(false)} onSaved={fetchLeads} />
      <CoworkBar onResult={() => fetchLeads()} />

      {/* Auto-assign modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h2 className="font-semibold text-lg mb-1">Leads verdelen</h2>
            <p className="text-sm text-gray-500 mb-4">Selecteer welke agents leads moeten krijgen</p>
            <div className="space-y-2 mb-4">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignAgents.has(a.id)}
                    onChange={() => toggleAssignAgent(a.id)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-xs text-gray-400 capitalize">{a.role}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAssignModal(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-pill text-sm font-medium hover:bg-gray-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleAutoAssign}
                disabled={assigning || assignAgents.size === 0}
                className="flex-1 py-2.5 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black disabled:opacity-50"
              >
                {assigning ? "Verdelen..." : `Verdeel over ${assignAgents.size || "alle"} agents`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
