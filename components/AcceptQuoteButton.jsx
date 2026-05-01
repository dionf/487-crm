"use client";

import { useState } from "react";

const COLORS = {
  border: "#e5e7eb",
  borderFocus: "#0D0D0F",
  text: "#0D0D0F",
  textMuted: "#6B7280",
  textLabel: "#374151",
  bgInput: "#fff",
  bgPanel: "#fafafa",
  accent: "#FAB868",
  accentDark: "#E5A04D",
  success: "#16a34a",
  error: "#dc2626",
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  fontSize: 14,
  color: COLORS.text,
  background: COLORS.bgInput,
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: COLORS.textLabel,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function AddressFields({ values, onChange, prefix }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Field label="Straat">
          <input
            style={inputStyle}
            value={values[`${prefix}_street`] || ""}
            onChange={(e) => onChange(`${prefix}_street`, e.target.value)}
            placeholder="Bijv. Hoofdstraat"
          />
        </Field>
        <Field label="Huisnummer">
          <input
            style={inputStyle}
            value={values[`${prefix}_house_number`] || ""}
            onChange={(e) => onChange(`${prefix}_house_number`, e.target.value)}
            placeholder="12A"
          />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
        <Field label="Postcode">
          <input
            style={inputStyle}
            value={values[`${prefix}_postal_code`] || ""}
            onChange={(e) => onChange(`${prefix}_postal_code`, e.target.value)}
            placeholder="1234 AB"
          />
        </Field>
        <Field label="Plaats">
          <input
            style={inputStyle}
            value={values[`${prefix}_city`] || ""}
            onChange={(e) => onChange(`${prefix}_city`, e.target.value)}
            placeholder="Amsterdam"
          />
        </Field>
      </div>
      <Field label="Land">
        <input
          style={inputStyle}
          value={values[`${prefix}_country`] || "NL"}
          onChange={(e) => onChange(`${prefix}_country`, e.target.value)}
        />
      </Field>
    </>
  );
}

export default function AcceptQuoteButton({ hash, tenant = "48-7", defaults = {} }) {
  const isHipHot = tenant === "hiphot";

  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showOptional, setShowOptional] = useState(
    !!(defaults.customer_reference || defaults.billing_email)
  );

  const hasBilling = !!defaults.billing_street;

  const [form, setForm] = useState({
    billing_street: defaults.billing_street || "",
    billing_house_number: defaults.billing_house_number || "",
    billing_postal_code: defaults.billing_postal_code || "",
    billing_city: defaults.billing_city || "",
    billing_country: defaults.billing_country || "NL",
    delivery_same_as_billing:
      defaults.delivery_same_as_billing === false ? false : true,
    delivery_street: defaults.delivery_street || "",
    delivery_house_number: defaults.delivery_house_number || "",
    delivery_postal_code: defaults.delivery_postal_code || "",
    delivery_city: defaults.delivery_city || "",
    delivery_country: defaults.delivery_country || "NL",
    customer_reference: defaults.customer_reference || "",
    billing_email: defaults.billing_email || "",
  });

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAccept() {
    setLoading(true);
    setError("");

    // Bouw body. Voor 48-7 sturen we geen delivery-velden mee — server forceert sowieso same_as_billing.
    const payload = {
      billing_street: form.billing_street,
      billing_house_number: form.billing_house_number,
      billing_postal_code: form.billing_postal_code,
      billing_city: form.billing_city,
      billing_country: form.billing_country,
      customer_reference: form.customer_reference,
      billing_email: form.billing_email,
    };

    if (isHipHot) {
      payload.delivery_same_as_billing = form.delivery_same_as_billing;
      if (form.delivery_same_as_billing === false) {
        payload.delivery_street = form.delivery_street;
        payload.delivery_house_number = form.delivery_house_number;
        payload.delivery_postal_code = form.delivery_postal_code;
        payload.delivery_city = form.delivery_city;
        payload.delivery_country = form.delivery_country;
      }
    }

    try {
      const res = await fetch(`/api/public/quotes/${hash}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Er ging iets mis");
      }

      setAccepted(true);
      setShowForm(false);
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

  if (showForm) {
    const headerText = hasBilling
      ? "Bevestig je gegevens"
      : "Vul je gegevens aan";
    const subText = hasBilling
      ? "Controleer de gegevens hieronder voor de verwerking. Pas aan waar nodig."
      : isHipHot
        ? "Vul hieronder je verzend- en factuurgegevens in zodat we de bestelling kunnen verwerken."
        : "Vul hieronder je factuurgegevens in zodat we de eerste factuur correct kunnen versturen.";

    return (
      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
          padding: "28px 32px",
          textAlign: "left",
          maxWidth: 560,
          margin: "0 auto",
        }}
      >
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: COLORS.text,
            margin: "0 0 6px",
          }}
        >
          {headerText}
        </h3>
        <p style={{ fontSize: 14, color: COLORS.textMuted, margin: "0 0 20px" }}>
          {subText}
        </p>

        {defaults.company_name && (
          <div
            style={{
              padding: "10px 14px",
              background: COLORS.bgPanel,
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
              color: COLORS.textLabel,
            }}
          >
            <span style={{ color: COLORS.textMuted }}>Bedrijf: </span>
            <strong>{defaults.company_name}</strong>
          </div>
        )}

        <h4 style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, margin: "16px 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {isHipHot ? "Verzend- / factuuradres" : "Factuuradres"}
        </h4>
        <AddressFields values={form} onChange={setField} prefix="billing" />

        {isHipHot && (
          <>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                margin: "16px 0",
                fontSize: 14,
                color: COLORS.textLabel,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.delivery_same_as_billing === false}
                onChange={(e) =>
                  setField("delivery_same_as_billing", !e.target.checked)
                }
              />
              Ik wil een ander factuuradres opgeven
            </label>

            {form.delivery_same_as_billing === false && (
              <div
                style={{
                  background: COLORS.bgPanel,
                  borderRadius: 12,
                  padding: "16px 18px",
                  marginBottom: 16,
                }}
              >
                <h4 style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Factuuradres (afwijkend)
                </h4>
                <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "0 0 12px" }}>
                  De velden hierboven worden gebruikt als verzendadres. Vul hieronder het afwijkende factuuradres in.
                </p>
                <AddressFields values={form} onChange={setField} prefix="delivery" />
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => setShowOptional(!showOptional)}
          style={{
            background: "none",
            border: "none",
            padding: "8px 0",
            color: COLORS.textMuted,
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 500,
            marginTop: 8,
          }}
        >
          {showOptional ? "▾" : "▸"} Optioneel — referentie & factuur-e-mail
        </button>

        {showOptional && (
          <div style={{ marginTop: 8 }}>
            <Field label="Eigen referentie / PO-nummer (optioneel)">
              <input
                style={inputStyle}
                value={form.customer_reference}
                onChange={(e) => setField("customer_reference", e.target.value)}
                placeholder="Bijv. PO-2026-0123"
              />
            </Field>
            <Field label="Apart factuur-e-mailadres (optioneel)">
              <input
                style={inputStyle}
                type="email"
                value={form.billing_email}
                onChange={(e) => setField("billing_email", e.target.value)}
                placeholder="facturen@bedrijf.nl"
              />
            </Field>
          </div>
        )}

        <p style={{ fontSize: 12, color: COLORS.textMuted, margin: "20px 0 12px" }}>
          Door te bevestigen ga je akkoord met de voorwaarden in deze offerte.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            onClick={() => setShowForm(false)}
            disabled={loading}
            style={{
              padding: "12px 24px",
              borderRadius: 999,
              border: `1px solid ${COLORS.border}`,
              background: "#fff",
              color: COLORS.textLabel,
              fontWeight: 500,
              fontSize: 14,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            Annuleren
          </button>
          <button
            onClick={handleAccept}
            disabled={loading}
            style={{
              padding: "12px 28px",
              borderRadius: 999,
              border: "none",
              background: loading ? "#d1d5db" : COLORS.success,
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: loading ? "wait" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {loading ? "Bezig met verwerken..." : "Bevestig en accepteer"}
          </button>
        </div>
        {error && (
          <p style={{ marginTop: 12, fontSize: 14, color: COLORS.error }}>{error}</p>
        )}
      </div>
    );
  }

  // Initial state — show accept button
  return (
    <div style={{ textAlign: "center" }}>
      <button
        onClick={() => setShowForm(true)}
        style={{
          display: "inline-block",
          background: COLORS.accent,
          color: COLORS.text,
          fontWeight: 600,
          fontSize: 16,
          padding: "14px 36px",
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseOver={(e) => (e.target.style.background = COLORS.accentDark)}
        onMouseOut={(e) => (e.target.style.background = COLORS.accent)}
      >
        ✓ Akkoord — Offerte accepteren
      </button>
      <p style={{ marginTop: 12, fontSize: 14, color: COLORS.textMuted }}>
        Door te accepteren ga je akkoord met de voorwaarden in deze offerte.
      </p>
    </div>
  );
}
