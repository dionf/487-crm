"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import StatusBadge from "@/components/StatusBadge";
import LeadForm from "@/components/LeadForm";
import CoworkBar from "@/components/CoworkBar";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { SERVICE_TYPES, LEAD_STATUSES } from "@/lib/constants";
import {
  Plus,
  Search,
  FileText,
  MessageSquare,
  CircleDot,
  ArrowUpDown,
  Filter,
} from "lucide-react";

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [showLeadForm, setShowLeadForm] = useState(false);

  const fetchLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (serviceFilter) params.set("service_type", serviceFilter);

    try {
      const res = await fetch(`/api/leads?${params}`);
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      console.error("Failed to fetch leads");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, serviceFilter]);

  useEffect(() => {
    const timeout = setTimeout(fetchLeads, 300);
    return () => clearTimeout(timeout);
  }, [fetchLeads]);

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-black">Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {leads.length} leads gevonden
          </p>
        </div>
        <button
          onClick={() => setShowLeadForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-amber hover:bg-brand-amber-hover rounded-pill text-sm font-semibold text-brand-black transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nieuwe Lead
        </button>
      </div>

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
          {LEAD_STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
        >
          <option value="">Alle services</option>
          {SERVICE_TYPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Bedrijf
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Service
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Waarde
                </th>
                <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Info
                </th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                  Bijgewerkt
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-brand-amber border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400 text-sm">
                    Geen leads gevonden
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="block">
                        <p className="font-semibold text-sm text-brand-black">
                          {lead.company_name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {lead.contact_person}
                        </p>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600">
                        {SERVICE_TYPES.find((s) => s.id === lead.service_type)
                          ?.label || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-medium">
                        {formatCurrency(lead.estimated_value)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-3 text-gray-400">
                        {lead.quote_count > 0 && (
                          <span className="flex items-center gap-1 text-xs">
                            <FileText className="w-3.5 h-3.5" />
                            {lead.quote_count}
                          </span>
                        )}
                        {lead.note_count > 0 && (
                          <span className="flex items-center gap-1 text-xs">
                            <MessageSquare className="w-3.5 h-3.5" />
                            {lead.note_count}
                          </span>
                        )}
                        {lead.open_todo_count > 0 && (
                          <span className="flex items-center gap-1 text-xs text-red-500 font-semibold">
                            <CircleDot className="w-3.5 h-3.5" />
                            {lead.open_todo_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-gray-400">
                        {formatRelativeTime(lead.updated_at)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeadForm
        open={showLeadForm}
        onClose={() => setShowLeadForm(false)}
        onSaved={fetchLeads}
      />
      <CoworkBar onResult={() => fetchLeads()} />
    </AppShell>
  );
}
