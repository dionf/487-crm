"use client";

import { useState } from "react";

export default function AcceptQuoteButton({ hash }) {
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleAccept() {
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
      setShowConfirm(false);
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
          padding: "32px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
        <h3
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#166534",
            marginBottom: 8,
          }}
        >
          Bedankt! Offerte geaccepteerd.
        </h3>
        <p style={{ fontSize: 15, color: "#15803d", margin: 0, lineHeight: 1.5 }}>
          We nemen spoedig contact met je op om de vervolgstappen te bespreken.
        </p>
      </div>
    );
  }

  // Confirmation step
  if (showConfirm) {
    return (
      <div
        style={{
          background: "#fffbeb",
          border: "2px solid #fde68a",
          borderRadius: 16,
          padding: "28px 32px",
          textAlign: "center",
        }}
      >
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "#92400e",
            marginBottom: 8,
          }}
        >
          Weet je het zeker?
        </h3>
        <p style={{ fontSize: 14, color: "#78716c", marginBottom: 20 }}>
          Door te bevestigen ga je akkoord met de voorwaarden in deze offerte.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => setShowConfirm(false)}
            disabled={loading}
            style={{
              padding: "12px 28px",
              borderRadius: 999,
              border: "1px solid #d1d5db",
              background: "#fff",
              color: "#374151",
              fontWeight: 500,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Annuleren
          </button>
          <button
            onClick={handleAccept}
            disabled={loading}
            style={{
              padding: "12px 32px",
              borderRadius: 999,
              border: "none",
              background: loading ? "#d1d5db" : "#16a34a",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              cursor: loading ? "wait" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Bezig met verwerken..." : "Ja, ik ga akkoord"}
          </button>
        </div>
        {error && (
          <p style={{ marginTop: 12, fontSize: 14, color: "#dc2626" }}>{error}</p>
        )}
      </div>
    );
  }

  // Initial state — show accept button
  return (
    <div style={{ textAlign: "center" }}>
      <button
        onClick={() => setShowConfirm(true)}
        style={{
          display: "inline-block",
          background: "#FAB868",
          color: "#0D0D0F",
          fontWeight: 600,
          fontSize: 16,
          padding: "14px 36px",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={(e) => (e.target.style.background = "#E5A04D")}
        onMouseOut={(e) => (e.target.style.background = "#FAB868")}
      >
        ✓ Akkoord — Offerte accepteren
      </button>
      <p style={{ marginTop: 12, fontSize: 14, color: "#6B7280" }}>
        Door te accepteren ga je akkoord met de voorwaarden in deze offerte.
      </p>
    </div>
  );
}
