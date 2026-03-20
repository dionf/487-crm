"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/utils";
import {
  TrendingUp,
  Target,
  DollarSign,
  Users,
  CheckCircle,
  Clock,
  BarChart3,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export default function StatsPanel({ leads }) {
  const [metrics, setMetrics] = useState(null);
  const [metricsOpen, setMetricsOpen] = useState(false);

  useEffect(() => {
    if (metricsOpen && !metrics) {
      fetch("/api/metrics")
        .then((r) => r.json())
        .then((data) => setMetrics(data.metrics || []))
        .catch(() => setMetrics([]));
    }
  }, [metricsOpen, metrics]);

  const activePipeline = leads.filter(
    (l) => !["gewonnen", "verloren"].includes(l.status)
  );
  const pipelineValue = activePipeline.reduce(
    (sum, l) => sum + (parseFloat(l.estimated_value) || 0),
    0
  );

  const won = leads.filter((l) => l.status === "gewonnen");
  const lost = leads.filter((l) => l.status === "verloren");
  const winRate =
    won.length + lost.length > 0
      ? Math.round((won.length / (won.length + lost.length)) * 100)
      : 0;

  const wonValue = won.reduce(
    (sum, l) => sum + (parseFloat(l.estimated_value) || 0),
    0
  );

  // Avg sales cycle for won deals
  const avgCycleDays = won.length > 0
    ? Math.round(
        won.reduce((sum, l) => {
          const created = new Date(l.created_at);
          const closed = new Date(l.won_at || l.updated_at);
          return sum + (closed - created) / (1000 * 60 * 60 * 24);
        }, 0) / won.length
      )
    : null;

  const stats = [
    {
      label: "Pipeline waarde",
      value: formatCurrency(pipelineValue),
      icon: DollarSign,
      color: "bg-amber-100 text-amber-700",
    },
    {
      label: "Gewonnen",
      value: formatCurrency(wonValue),
      icon: CheckCircle,
      color: "bg-green-100 text-green-700",
    },
    {
      label: "Win rate",
      value: `${winRate}%`,
      icon: Target,
      color: "bg-blue-100 text-blue-700",
    },
    {
      label: "Actieve leads",
      value: activePipeline.length,
      icon: Users,
      color: "bg-purple-100 text-purple-700",
    },
  ];

  // Group metrics by service type
  const metricsByType = metrics
    ? metrics.reduce((acc, m) => {
        if (!m.service_type) return acc;
        if (!acc[m.service_type]) acc[m.service_type] = { leads: 0, value: 0, won: 0, lost: 0, winRate: null, avgDays: null };
        acc[m.service_type].leads += parseInt(m.lead_count) || 0;
        acc[m.service_type].value += parseFloat(m.total_value) || 0;
        acc[m.service_type].won += parseInt(m.won_count) || 0;
        acc[m.service_type].lost += parseInt(m.lost_count) || 0;
        if (m.win_rate_percentage) acc[m.service_type].winRate = parseFloat(m.win_rate_percentage);
        if (m.avg_sales_cycle_days) acc[m.service_type].avgDays = parseInt(m.avg_sales_cycle_days);
        return acc;
      }, {})
    : {};

  const serviceTypeLabels = {
    discovery: "Discovery / Intake",
    cowork_setup: "Cowork Setup",
    training: "Training / Workshop",
    maatwerk: "Maatwerk Project",
    support_contract: "Support Contract",
    partner: "Partner Deal",
  };

  return (
    <div className="space-y-4 mb-6">
      {/* Main stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white border border-gray-100 rounded-card p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${stat.color}`}
              >
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {stat.label}
                </p>
                <p className="text-lg font-bold text-brand-black">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Metrics breakdown */}
      <div className="bg-white border border-gray-100 rounded-card overflow-hidden">
        <button
          onClick={() => setMetricsOpen(!metricsOpen)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              className={`w-4 h-4 text-gray-400 transition-transform ${metricsOpen ? "rotate-90" : ""}`}
            />
            <BarChart3 className="w-4 h-4 text-brand-orange" />
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Pipeline Metrics per Service Type
            </h3>
          </div>
          {avgCycleDays !== null && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              Gem. cyclus: {avgCycleDays} dagen
            </div>
          )}
        </button>

        {metricsOpen && (
          <div className="px-5 pb-4">
            {!metrics ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-brand-amber border-t-transparent rounded-full animate-spin" />
              </div>
            ) : Object.keys(metricsByType).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Nog geen data</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(metricsByType).map(([type, data]) => (
                  <div key={type} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{serviceTypeLabels[type] || type}</p>
                      <p className="text-xs text-gray-400">
                        {data.leads} leads &middot; {data.won} gewonnen &middot; {data.lost} verloren
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div>
                        <p className="text-sm font-semibold">{formatCurrency(data.value)}</p>
                        <p className="text-[10px] text-gray-400 uppercase">Waarde</p>
                      </div>
                      {data.winRate !== null && (
                        <div>
                          <p className={`text-sm font-semibold ${data.winRate >= 50 ? "text-green-600" : data.winRate > 0 ? "text-amber-600" : "text-red-500"}`}>
                            {data.winRate}%
                          </p>
                          <p className="text-[10px] text-gray-400 uppercase">Win rate</p>
                        </div>
                      )}
                      {data.avgDays !== null && (
                        <div>
                          <p className="text-sm font-semibold">{data.avgDays}d</p>
                          <p className="text-[10px] text-gray-400 uppercase">Cyclus</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
