"use client";

import { campaignTargetIds, segmentCanExclude, sourceTypeLabel } from "@/lib/newsletter-audience";

// "Mailen naar" en "Niet mailen naar" voor een campagneformulier. form bevat
// included_segment_ids, segment_id en excluded_segment_ids; setForm krijgt
// een updater-functie.
export default function AudienceFields({ segments, form, setForm, disabled = false }) {
  const targetIds = campaignTargetIds(form);
  const targetSegments = targetIds.map((id) => segments.find((segment) => segment.id === id)).filter(Boolean);
  const availableTargets = segments.filter((segment) => !segment.default_excluded);
  const availableExclusions = segments.filter((segment) => segmentCanExclude(segment, targetSegments));
  const defaultExcludedIds = segments.filter((segment) => segment.default_excluded).map((segment) => segment.id);
  const excludedIds = new Set([...(form.excluded_segment_ids || []), ...defaultExcludedIds]);

  function toggleTarget(segmentId) {
    setForm((current) => {
      const currentTargets = new Set(campaignTargetIds(current));
      if (currentTargets.has(segmentId)) {
        if (currentTargets.size === 1) return current;
        currentTargets.delete(segmentId);
      } else {
        currentTargets.add(segmentId);
      }
      const targets = [...currentTargets];
      return {
        ...current,
        segment_id: targets[0] || "",
        included_segment_ids: targets,
        excluded_segment_ids: (current.excluded_segment_ids || []).filter((id) => id !== segmentId),
      };
    });
  }

  function toggleExcluded(segmentId) {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segmentCanExclude(segment, targetSegments)) return;
    setForm((current) => {
      const next = new Set(current.excluded_segment_ids || []);
      if (next.has(segmentId)) next.delete(segmentId);
      else next.add(segmentId);
      return { ...current, excluded_segment_ids: [...next] };
    });
  }

  return (
    <>
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="block text-xs font-semibold text-gray-500 uppercase">Mailen naar</label>
          <span className="text-xs text-gray-400">{targetIds.length} gekozen</span>
        </div>
        {availableTargets.length ? (
          <div className="space-y-2 max-h-48 overflow-auto">
            {availableTargets.map((segment) => (
              <label key={segment.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={targetIds.includes(segment.id)}
                    disabled={disabled}
                    onChange={() => toggleTarget(segment.id)}
                    className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                  />
                  <span className="truncate">{segment.name}</span>
                </span>
                <span className="shrink-0 text-[10px] font-semibold uppercase text-gray-400">
                  {sourceTypeLabel(segment.source_type)}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Maak eerst een doelgroepsegment aan.</p>
        )}
        <p className="text-xs text-gray-500">
          Meerdere doelgroepen worden samengevoegd. Dubbele e-mailadressen worden bij verzending automatisch ontdubbeld.
        </p>
      </div>
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Niet mailen naar</p>
        <p className="text-xs text-gray-500 mb-2">Deze segmenten worden van de gekozen doelgroep(en) afgehaald.</p>
        {availableExclusions.length ? (
          <div className="space-y-2 max-h-44 overflow-auto">
            {availableExclusions.map((segment) => (
              <label key={segment.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={excludedIds.has(segment.id)}
                    disabled={disabled || segment.default_excluded}
                    onChange={() => toggleExcluded(segment.id)}
                    className="rounded border-gray-300 text-brand-orange focus:ring-brand-amber"
                  />
                  <span className="truncate">{segment.name}</span>
                </span>
                {segment.default_excluded && (
                  <span className="shrink-0 text-[10px] font-bold uppercase text-red-600 bg-red-50 border border-red-100 rounded-pill px-2 py-0.5">
                    standaard
                  </span>
                )}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Nog geen segmenten om uit te sluiten.</p>
        )}
      </div>
    </>
  );
}
