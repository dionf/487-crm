"use client";

export default function QuotePrintButtons({ language = "nl" }) {
  const labels = {
    nl: { print: "Afdrukken", download: "Downloaden" },
    en: { print: "Print", download: "Download" },
    de: { print: "Drucken", download: "Herunterladen" },
    fr: { print: "Imprimer", download: "Télécharger" },
  };
  const l = labels[language] || labels.nl;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "16px 32px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <button
        onClick={() => window.print()}
        style={{ padding: "8px 20px", fontSize: 14, fontWeight: 600, border: "1px solid #ddd", borderRadius: 8, background: "#fff", cursor: "pointer" }}
      >
        {l.print}
      </button>
      <button
        onClick={() => window.print()}
        style={{ padding: "8px 20px", fontSize: 14, fontWeight: 600, border: "none", borderRadius: 8, background: "#f5a623", color: "#fff", cursor: "pointer" }}
      >
        {l.download}
      </button>
    </div>
  );
}
