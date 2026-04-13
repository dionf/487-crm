"use client";

import { useState, useEffect, useCallback } from "react";
import AppShell from "@/components/AppShell";
import { useOrg } from "@/lib/org-context";
import { apiFetch } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Upload, ArrowLeft, Check, AlertCircle, FileSpreadsheet, ArrowRight } from "lucide-react";
import * as XLSX from "xlsx";

const KNOWN_MAPPINGS = {
  "nr": null, // skip
  "organisatie": "company_name",
  "bedrijfsnaam": "company_name",
  "company": "company_name",
  "naam": "company_name",
  "contactpersoon": "contact_person",
  "contact": "contact_person",
  "voornaam": "contact_first_name",
  "first name": "contact_first_name",
  "achternaam": "contact_last_name",
  "last name": "contact_last_name",
  "functie": "contact_function",
  "function": "contact_function",
  "rol": "contact_function",
  "role": "contact_function",
  "plaats": "city",
  "stad": "city",
  "city": "city",
  "hoofdcategorie": "category",
  "categorie": "category",
  "category": "category",
  "branche": "industry",
  "industry": "industry",
  "adres": "address",
  "address": "address",
  "telefoonnummer": "phone",
  "telefoon": "phone",
  "phone": "phone",
  "email": "email",
  "e-mail": "email",
  "website": "website_url",
  "url": "website_url",
  "opmerkingen": "internal_notes",
  "notities": "internal_notes",
  "notes": "internal_notes",
};

const TARGET_FIELDS = [
  { id: "skip", label: "— Overslaan —" },
  { id: "company_name", label: "Bedrijfsnaam" },
  { id: "contact_person", label: "Contactpersoon (vol)" },
  { id: "contact_first_name", label: "Voornaam" },
  { id: "contact_last_name", label: "Achternaam" },
  { id: "contact_function", label: "Functie" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Telefoon" },
  { id: "website_url", label: "Website" },
  { id: "city", label: "Plaats" },
  { id: "category", label: "Categorie" },
  { id: "industry", label: "Branche" },
  { id: "address", label: "Adres" },
  { id: "internal_notes", label: "Opmerkingen (intern)" },
];

export default function ImportPage() {
  const { isAdmin, loading: authLoading, organization } = useOrg();
  const router = useRouter();

  const [step, setStep] = useState("upload"); // upload → mapping → preview → importing → done
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!authLoading && !isAdmin) router.push("/");
  }, [isAdmin, authLoading, router]);

  const handleFile = useCallback((file) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (data.length === 0) return;

      const hdrs = Object.keys(data[0]);
      setHeaders(hdrs);
      setRawData(data);

      // Auto-map known columns
      const autoMap = {};
      hdrs.forEach((h) => {
        const normalized = h.toLowerCase().trim();
        if (KNOWN_MAPPINGS[normalized] !== undefined) {
          autoMap[h] = KNOWN_MAPPINGS[normalized] || "skip";
        } else {
          autoMap[h] = "skip";
        }
      });
      setMapping(autoMap);
      setStep("mapping");
    };
    reader.readAsArrayBuffer(file);
  }, []);

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function getMappedLeads() {
    return rawData.map((row) => {
      const lead = {};
      Object.entries(mapping).forEach(([header, field]) => {
        if (field && field !== "skip") {
          lead[field] = row[header] || null;
        }
      });
      return lead;
    }).filter((l) => l.company_name || l.email || l.phone);
  }

  async function startImport() {
    setImporting(true);
    setStep("importing");
    const leads = getMappedLeads();
    const batchSize = 50;
    let totalImported = 0;
    let totalDuplicates = 0;
    let totalErrors = 0;
    let allDetails = [];

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);
      const res = await apiFetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: batch, default_status: "nieuwe_aanvraag" }),
      });
      const data = await res.json();
      if (data.results) {
        totalImported += data.results.imported;
        totalDuplicates += data.results.duplicates;
        totalErrors += data.results.errors;
        if (data.results.details) allDetails = [...allDetails, ...data.results.details.filter(d => d.status !== "imported")];
      }
      setProgress(Math.min(100, Math.round(((i + batchSize) / leads.length) * 100)));
    }

    setResult({ imported: totalImported, duplicates: totalDuplicates, errors: totalErrors, total: leads.length, details: allDetails });
    setStep("done");
    setImporting(false);
  }

  const mappedLeads = step === "preview" ? getMappedLeads() : [];
  const accentColor = organization?.theme?.accent || "#F5A623";

  return (
    <AppShell>
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-black mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Terug
      </button>

      <h1 className="text-2xl font-bold text-brand-black mb-1">Leads Importeren</h1>
      <p className="text-sm text-gray-500 mb-6">Upload een Excel of CSV bestand</p>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center hover:border-gray-400 transition-colors cursor-pointer"
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".xlsx,.xls,.csv";
            input.onchange = (e) => e.target.files[0] && handleFile(e.target.files[0]);
            input.click();
          }}
        >
          <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600">Sleep een bestand hierheen of klik om te uploaden</p>
          <p className="text-xs text-gray-400 mt-1">Excel (.xlsx, .xls) of CSV</p>
        </div>
      )}

      {/* Step 2: Column mapping */}
      {step === "mapping" && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <FileSpreadsheet className="w-5 h-5 text-brand-orange" />
            <p className="text-sm font-medium">{fileName} — {rawData.length} rijen gevonden</p>
          </div>

          <div className="bg-white border border-gray-100 rounded-card p-5 mb-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Kolom mapping</h3>
            <div className="space-y-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-48 truncate">{h}</span>
                  <ArrowRight className="w-4 h-4 text-gray-300" />
                  <select
                    value={mapping[h] || "skip"}
                    onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                    className="flex-1 px-3 py-1.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-brand-amber"
                  >
                    {TARGET_FIELDS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("upload")} className="px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium hover:bg-gray-50">
              Terug
            </button>
            <button
              onClick={() => setStep("preview")}
              className="px-4 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ backgroundColor: accentColor }}
            >
              Preview bekijken ({rawData.length} leads)
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && (
        <div>
          <p className="text-sm text-gray-500 mb-4">{mappedLeads.length} leads klaar voor import</p>
          <div className="bg-white border border-gray-100 rounded-card overflow-hidden mb-4">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">#</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Bedrijf</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Contact</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Email</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Telefoon</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Plaats</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Branche</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedLeads.slice(0, 50).map((l, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.company_name || "—"}</td>
                      <td className="px-3 py-2">{l.contact_person || "—"}</td>
                      <td className="px-3 py-2">{l.email || "—"}</td>
                      <td className="px-3 py-2">{l.phone || "—"}</td>
                      <td className="px-3 py-2">{l.city || "—"}</td>
                      <td className="px-3 py-2">{l.industry || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mappedLeads.length > 50 && (
              <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50">
                ... en {mappedLeads.length - 50} meer
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("mapping")} className="px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium hover:bg-gray-50">
              Terug
            </button>
            <button
              onClick={startImport}
              className="px-6 py-2 rounded-pill text-sm font-semibold text-white"
              style={{ backgroundColor: accentColor }}
            >
              Importeer {mappedLeads.length} leads
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Importing */}
      {step === "importing" && (
        <div className="text-center py-12">
          <div className="w-10 h-10 border-3 border-brand-amber border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium">Leads importeren...</p>
          <div className="w-64 mx-auto mt-4 bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${progress}%`, backgroundColor: accentColor }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">{progress}%</p>
        </div>
      )}

      {/* Step 5: Done */}
      {step === "done" && result && (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-6 h-6 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Import voltooid</h2>
          <div className="space-y-1 text-sm text-gray-600">
            <p><span className="font-semibold text-green-600">{result.imported}</span> leads geïmporteerd</p>
            {result.duplicates > 0 && (
              <p><span className="font-semibold text-amber-600">{result.duplicates}</span> duplicaten overgeslagen</p>
            )}
            {result.errors > 0 && (
              <p><span className="font-semibold text-red-600">{result.errors}</span> fouten</p>
            )}
          </div>
          {result.details?.length > 0 && (
            <div className="mt-4 text-left max-w-md mx-auto max-h-48 overflow-y-auto bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Details</p>
              {result.details.map((d, i) => (
                <div key={i} className="text-xs py-1 border-b border-gray-100 last:border-0">
                  <span className="font-medium">{d.company || "?"}</span>
                  <span className={`ml-2 ${d.status === "error" ? "text-red-600" : d.status === "duplicate" ? "text-amber-600" : "text-gray-500"}`}>
                    {d.status === "error" ? `Fout: ${d.error}` : d.status === "duplicate" ? "Duplicaat" : d.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => router.push("/leads")}
            className="mt-6 px-6 py-2 rounded-pill text-sm font-semibold text-white"
            style={{ backgroundColor: accentColor }}
          >
            Bekijk leads
          </button>
        </div>
      )}
    </AppShell>
  );
}
