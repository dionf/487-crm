"use client";

import { formatCurrency } from "@/lib/utils";
import { TrendingUp, Target, DollarSign, Users, FileText, CheckCircle } from "lucide-react";

export default function StatsPanel({ leads }) {
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

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
  );
}
