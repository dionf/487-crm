"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Plus, Search, Sparkles, Trash2, Users } from "lucide-react";
import { excludedSegmentNames, targetSegmentNames } from "@/lib/newsletter-audience";
import {
  STATUS_GROUPS,
  campaignDateLabel,
  canMutateCampaign,
  statusClass,
  statusGroup,
  statusLabel,
} from "@/lib/newsletter-status";

const FILTER_IDS = new Set(["alle", ...STATUS_GROUPS.map((group) => group.id)]);

export function campaignHref(campaign) {
  return `/admin/nieuwsbrieven/${campaign.id}`;
}

// Nieuwste eerst; bij ingepland de eerstvolgende bovenaan.
function sortCampaigns(list, groupId) {
  return [...list].sort((a, b) => {
    if (groupId === "ingepland") return new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0);
    const dateA = new Date(a.sent_at || a.created_at || 0);
    const dateB = new Date(b.sent_at || b.created_at || 0);
    return dateB - dateA;
  });
}

function readFilterFromUrl() {
  if (typeof window === "undefined") return "alle";
  const value = new URLSearchParams(window.location.search).get("status");
  return FILTER_IDS.has(value) ? value : "alle";
}

function RowMenu({ campaign, busy, onShowRecipients, onDelete }) {
  // Positie van het menu (fixed), zodat de scrollende tabel het niet afknipt.
  const [position, setPosition] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const open = Boolean(position);
  const deleting = busy === `delete-campaign-${campaign.id}`;

  function positionFromButton() {
    const rect = buttonRef.current.getBoundingClientRect();
    return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
  }

  function toggle() {
    setPosition(open ? null : positionFromButton());
  }

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setPosition(null);
    // Bij scrollen schuift het menu mee met de knop; bij een andere schermmaat sluit het.
    const follow = () => setPosition(positionFromButton());
    const closeNow = () => setPosition(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", closeNow);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", closeNow);
    };
  }, [open]);

  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="p-2 rounded-lg text-gray-400 hover:text-brand-black hover:bg-gray-100"
        title="Meer acties"
      >
        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
      </button>
      {open && (
        <div className="fixed z-40 w-52 rounded-xl border border-gray-100 bg-white shadow-lg py-1 text-left" style={position}>
          <button
            type="button"
            onClick={() => { setPosition(null); onShowRecipients(campaign); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
          >
            <Users className="w-4 h-4 text-gray-400" />
            Ontvangers bekijken
          </button>
          {canMutateCampaign(campaign) && (
            <button
              type="button"
              onClick={() => { setPosition(null); onDelete(campaign); }}
              disabled={deleting}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              Verwijderen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignTable({ campaigns, segments, busy, onShowRecipients, onDelete }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Campagne</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Doelgroep</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Datum</th>
            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Acties</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const excluded = excludedSegmentNames(campaign, segments);
            return (
              <tr
                key={campaign.id}
                onClick={() => router.push(campaignHref(campaign))}
                className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer align-top"
              >
                <td className="px-4 py-3">
                  <p className="text-sm font-semibold">
                    {campaign.name}
                    {campaign.mode === "personalized" && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-brand-orange bg-amber-50 border border-amber-100 rounded-pill px-2 py-0.5 align-middle">
                        <Sparkles className="w-3 h-3" />
                        Gepersonaliseerd
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{campaign.subject}</p>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  <p>{targetSegmentNames(campaign, segments).join(", ") || "Geen doelgroep"}</p>
                  {excluded.length > 0 && <p className="text-xs text-red-500 mt-1">Niet mailen: {excluded.join(", ")}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-pill border ${statusClass(campaign.status)}`}>
                    {statusLabel(campaign.status)}
                  </span>
                  {campaign.batch_mode === "automatic" && ["syncing", "batch_waiting", "paused"].includes(campaign.status) && (
                    <p className="text-xs text-gray-400 mt-1">
                      Batches: {campaign.batch_current_number || 0}/{campaign.batch_total_count || "?"}
                    </p>
                  )}
                  {campaign.batch_pause_reason && <p className="text-xs text-red-500 mt-1">{campaign.batch_pause_reason}</p>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  <p>{campaignDateLabel(campaign)}</p>
                  {campaign.recipient_count > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">{campaign.recipient_count} ontvangers</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <Link
                      href={campaignHref(campaign)}
                      onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1.5 rounded-pill text-xs font-semibold border border-gray-200 bg-white hover:border-brand-amber"
                    >
                      Openen
                    </Link>
                    <RowMenu campaign={campaign} busy={busy} onShowRecipients={onShowRecipients} onDelete={onDelete} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Overzicht van alle campagnes, te filteren op status. Bij "Alle" staan
// lopende en conceptcampagnes los van de verzonden campagnes.
export default function CampaignList({ campaigns, segments, busy, onShowRecipients, onDelete }) {
  const router = useRouter();
  const [filter, setFilter] = useState("alle");
  const [query, setQuery] = useState("");

  // Filter uit de URL, zodat de terugknop van de browser hetzelfde filter toont.
  useEffect(() => {
    setFilter(readFilterFromUrl());
  }, []);

  function chooseFilter(id) {
    setFilter(id);
    const params = new URLSearchParams(window.location.search);
    if (id === "alle") params.delete("status");
    else params.set("status", id);
    const search = params.toString();
    router.replace(`${window.location.pathname}${search ? `?${search}` : ""}`, { scroll: false });
  }

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return campaigns;
    return campaigns.filter((campaign) => (
      `${campaign.name || ""} ${campaign.subject || ""}`.toLowerCase().includes(needle)
    ));
  }, [campaigns, query]);

  const counts = useMemo(() => {
    const result = { alle: searched.length };
    for (const group of STATUS_GROUPS) result[group.id] = 0;
    for (const campaign of searched) result[statusGroup(campaign.status)] += 1;
    return result;
  }, [searched]);

  const sections = filter === "alle"
    ? [
        {
          id: "lopend",
          label: "Lopend en concept",
          campaigns: sortCampaigns(searched.filter((campaign) => statusGroup(campaign.status) !== "verzonden")),
        },
        {
          id: "verzonden",
          label: "Verzonden",
          campaigns: sortCampaigns(searched.filter((campaign) => statusGroup(campaign.status) === "verzonden")),
        },
      ]
    : [
        {
          id: filter,
          label: STATUS_GROUPS.find((group) => group.id === filter)?.label,
          campaigns: sortCampaigns(searched.filter((campaign) => statusGroup(campaign.status) === filter), filter),
        },
      ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-gray-100 bg-white p-1">
          {[{ id: "alle", label: "Alle" }, ...STATUS_GROUPS].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseFilter(item.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                filter === item.id ? "bg-amber-50 text-brand-orange" : "text-gray-500 hover:text-brand-black"
              }`}
            >
              {item.label}
              <span className="ml-1.5 font-normal text-gray-400">{counts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op naam of onderwerp"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-brand-amber"
          />
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.id} className="bg-white border border-gray-100 rounded-card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-sm">{section.label}</h2>
            <span className="text-sm text-gray-400">{section.campaigns.length}</span>
          </div>
          {section.campaigns.length ? (
            <CampaignTable
              campaigns={section.campaigns}
              segments={segments}
              busy={busy}
              onShowRecipients={onShowRecipients}
              onDelete={onDelete}
            />
          ) : (
            <div className="py-10 text-center text-sm text-gray-400">
              {query ? "Geen campagnes gevonden" : section.id === "verzonden" ? "Nog niets verzonden" : "Geen campagnes"}
              {section.id !== "verzonden" && !query && (
                <div className="mt-3">
                  <Link
                    href="/admin/nieuwsbrieven/nieuw"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-pill text-sm font-semibold border border-gray-200 text-brand-black hover:border-brand-amber"
                  >
                    <Plus className="w-4 h-4" />
                    Nieuwe campagne
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
