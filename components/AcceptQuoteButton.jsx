"use client";

import { useState } from "react";

export default function AcceptQuoteButton({ hash }) {
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");

  async function handleAccept() {
    if (!confirm("Weet je zeker dat je deze offerte wilt accepteren?")) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/public/quotes/${hash}/accept`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Er ging iets mis");
      }

      setAccepted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (accepted) {
    return (
      <div
        style={{
          background: "#f0fdf4",
          border: "2px solid #bbf7d0",
          borderRadius: 16,
          padding: "24px 32px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#166534",
            marginBottom: 4,
          }}
        >
          Bedankt! Offerte geaccepteerd.
        </h3>
        <p style={{ fontSize: 14, color: "#15803d", margin: 0 }}>
          We nemen spoedig contact met je op om de vervolgstappen te bespreken.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleAccept}
        disabled={loading}
        style={{
          display: "inline-block",
          background: loading ? "#d1d5db" : "#FAB868",
          color: "#0D0D0F",
          fontWeight: 600,
          fontSize: 16,
          padding: "14px 36px",
          borderRadius: 999,
          border: "none",
          cursor: loading ? "wait" : "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={(e) => {
          if (!loading) e.target.style.background = "#E5A04D";
        }}
        onMouseOut={(e) => {
          if (!loading) e.target.style.background = "#FAB868";
        }}
      >
        {loading ? "Bezig..." : "✓ Akkoord — Offerte accepteren"}
      </button>
      <p style={{ marginTop: 12, fontSize: 14, color: "#6B7280" }}>
        Door te accepteren ga je akkoord met de voorwaarden in deze offerte.
      </p>
      {error && (
        <p style={{ marginTop: 8, fontSize: 14, color: "#dc2626" }}>{error}</p>
      )}
    </div>
  );
}
