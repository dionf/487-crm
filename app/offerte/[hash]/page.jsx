import { createClient } from "@supabase/supabase-js";
import AcceptQuoteButton from "@/components/AcceptQuoteButton";
import QuotePrintButtons from "@/components/QuotePrintButtons";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function generateMetadata({ params }) {
  const { data: quote } = await supabase
    .from("quotes")
    .select("quote_number, leads(company_name)")
    .eq("public_hash", params.hash)
    .maybeSingle();

  return {
    title: quote
      ? `Offerte ${quote.quote_number} | 48-7 AI Professionals`
      : "Offerte | 48-7 AI Professionals",
    robots: "noindex, nofollow, noarchive, nosnippet",
  };
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function PublicQuotePage({ params }) {
  const { data: quote } = await supabase
    .from("quotes")
    .select("*, leads(company_name, contact_person, email)")
    .eq("public_hash", params.hash)
    .maybeSingle();

  if (!quote) {
    return <QuoteNotFound />;
  }

  const isExpired =
    quote.valid_until && new Date(quote.valid_until) < new Date();
  const isAccepted = !!quote.accepted_at;

  if (isExpired && !isAccepted) {
    return <QuoteExpired quote={quote} />;
  }

  // Get view count
  const { count } = await supabase
    .from("quote_views")
    .select("*", { count: "exact", head: true })
    .eq("quote_id", quote.id);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.48-7.nl";
  const trackUrl = `${baseUrl}/api/track/${params.hash}`;

  const vatAmount = (quote.amount_excl_vat * (quote.vat_percentage || 21)) / 100;
  const totalIncl = quote.amount_excl_vat + vatAmount;

  return (
    <>
      {/* Tracking pixel */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={trackUrl}
        width="1"
        height="1"
        alt=""
        style={{ position: "absolute", top: 0, left: 0, opacity: 0 }}
      />

      {quote.html_content ? (
        /* Render custom HTML template */
        <div>
          {/* Print/Download bar */}
          <QuotePrintButtons language={quote.language || "nl"} />
          <div dangerouslySetInnerHTML={{ __html: quote.html_content }} />
          {/* Acceptance section at bottom */}
          {!isAccepted && !isExpired && (
            <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 32px", textAlign: "center" }}>
              <AcceptQuoteButton hash={params.hash} />
            </div>
          )}
          {isAccepted && (
            <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 32px", textAlign: "center" }}>
              <AcceptedBanner acceptedAt={quote.accepted_at} />
            </div>
          )}
        </div>
      ) : (
        /* Default template */
        <DefaultQuoteTemplate
          quote={quote}
          vatAmount={vatAmount}
          totalIncl={totalIncl}
          isAccepted={isAccepted}
          isExpired={isExpired}
          hash={params.hash}
        />
      )}
    </>
  );
}

function DefaultQuoteTemplate({ quote, vatAmount, totalIncl, isAccepted, isExpired, hash }) {
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: "#fff", color: "#0D0D0F", lineHeight: 1.6, WebkitFontSmoothing: "antialiased" }}>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 32px" }}>
        {/* Header */}
        <header style={{ padding: "40px 0 32px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6B7280", marginBottom: 24, paddingBottom: 16, borderBottom: "3px solid #FAB868" }}>
            FULL SERVICE AI
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 6, lineHeight: 1.2 }}>
            Offerte {quote.quote_number}
          </h1>
          {quote.leads?.company_name && (
            <div style={{ fontSize: 17, fontWeight: 600, color: "#292828", marginBottom: 24 }}>
              Voor {quote.leads.company_name}
            </div>
          )}
          <div style={{ background: "#F4F4F4", borderRadius: 12, padding: "16px 24px", display: "inline-grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 14 }}>
            {quote.leads?.contact_person && (
              <>
                <span style={{ fontWeight: 600 }}>Contactpersoon:</span>
                <span style={{ color: "#292828" }}>{quote.leads.contact_person}</span>
              </>
            )}
            <span style={{ fontWeight: 600 }}>Datum:</span>
            <span style={{ color: "#292828" }}>{formatDate(quote.created_at)}</span>
            <span style={{ fontWeight: 600 }}>Kenmerk:</span>
            <span style={{ color: "#292828" }}>{quote.quote_number}</span>
            {quote.valid_until && (
              <>
                <span style={{ fontWeight: 600 }}>Geldig tot:</span>
                <span style={{ color: "#292828" }}>{formatDate(quote.valid_until)}</span>
              </>
            )}
          </div>
        </header>

        {/* Description */}
        {quote.description && (
          <section style={{ padding: "40px 0", borderTop: "1px solid #e5e7eb" }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Omschrijving</h2>
            <p style={{ fontSize: 15, color: "#292828", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
              {quote.description}
            </p>
          </section>
        )}

        {/* Pricing */}
        <section style={{ padding: "40px 0", borderTop: "1px solid #e5e7eb" }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Investering</h2>
          <div style={{ border: "2px solid #FAB868", borderRadius: 16, padding: "28px 32px", background: "linear-gradient(180deg, #fffdf7, #fff)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e5e7eb" }}>
              <span style={{ fontSize: 15, color: "#292828" }}>Bedrag excl. BTW</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#0D0D0F" }}>{formatCurrency(quote.amount_excl_vat)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e5e7eb" }}>
              <span style={{ fontSize: 15, color: "#6B7280" }}>BTW ({quote.vat_percentage || 21}%)</span>
              <span style={{ fontSize: 15, color: "#6B7280" }}>{formatCurrency(vatAmount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: "#0D0D0F" }}>Totaal incl. BTW</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: "#D4731C" }}>{formatCurrency(totalIncl)}</span>
            </div>
          </div>
        </section>

        {/* Validity */}
        {quote.valid_until && (
          <div style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px", marginTop: 24, fontSize: 14, color: "#6B7280" }}>
            Deze offerte is geldig tot <strong style={{ color: "#0D0D0F" }}>{formatDate(quote.valid_until)}</strong>.
            {" "}Neem contact op via{" "}
            <a href="mailto:dion@48-7.nl" style={{ color: "#D4731C", textDecoration: "none" }}>dion@48-7.nl</a>
            {" "}of{" "}
            <a href="tel:+31850601487" style={{ color: "#D4731C", textDecoration: "none" }}>085-06 01 487</a>.
          </div>
        )}

        {/* Accept / Accepted */}
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          {isAccepted ? (
            <AcceptedBanner acceptedAt={quote.accepted_at} />
          ) : (
            <AcceptQuoteButton hash={hash} />
          )}
        </div>

        {/* Footer */}
        <footer style={{ background: "#0D0D0F", color: "#9ca3af", padding: "32px 0", fontSize: 13, borderRadius: "12px 12px 0 0", marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 32px" }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>
              <span style={{ color: "#FAB868" }}>48</span>-7 AI Professionals
            </span>
            <span>
              <a href="https://48-7.nl" style={{ color: "#FAB868", textDecoration: "none" }}>48-7.nl</a>
              {" | "}
              <a href="mailto:dion@48-7.nl" style={{ color: "#FAB868", textDecoration: "none" }}>dion@48-7.nl</a>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AcceptedBanner({ acceptedAt }) {
  return (
    <div style={{ background: "#f0fdf4", border: "2px solid #bbf7d0", borderRadius: 16, padding: "24px 32px" }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#166534", marginBottom: 4 }}>
        Offerte geaccepteerd
      </h3>
      <p style={{ fontSize: 14, color: "#15803d", margin: 0 }}>
        Geaccepteerd op {formatDate(acceptedAt)}. We nemen spoedig contact met je op.
      </p>
    </div>
  );
}

function QuoteNotFound() {
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F4F4" }}>
      <div style={{ textAlign: "center", maxWidth: 400, padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#0D0D0F" }}>
          Offerte niet gevonden
        </h1>
        <p style={{ fontSize: 15, color: "#6B7280", marginBottom: 24 }}>
          Deze offerte bestaat niet of is niet meer beschikbaar.
        </p>
        <a
          href="mailto:dion@48-7.nl"
          style={{ display: "inline-block", background: "#FAB868", color: "#0D0D0F", fontWeight: 600, fontSize: 15, padding: "12px 32px", borderRadius: 999, textDecoration: "none" }}
        >
          Neem contact op
        </a>
      </div>
    </div>
  );
}

function QuoteExpired({ quote }) {
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F4F4" }}>
      <div style={{ textAlign: "center", maxWidth: 440, padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#0D0D0F" }}>
          Offerte verlopen
        </h1>
        <p style={{ fontSize: 15, color: "#6B7280", marginBottom: 8 }}>
          Offerte <strong>{quote.quote_number}</strong> was geldig tot{" "}
          <strong>{formatDate(quote.valid_until)}</strong>.
        </p>
        <p style={{ fontSize: 15, color: "#6B7280", marginBottom: 24 }}>
          Neem contact op om deze offerte te heropenen of een nieuwe versie te ontvangen.
        </p>
        <a
          href="mailto:dion@48-7.nl?subject=Heropenen offerte ${quote.quote_number}"
          style={{ display: "inline-block", background: "#FAB868", color: "#0D0D0F", fontWeight: 600, fontSize: 15, padding: "12px 32px", borderRadius: 999, textDecoration: "none" }}
        >
          Neem contact op om te heropenen
        </a>
      </div>
    </div>
  );
}
