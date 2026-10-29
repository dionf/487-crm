"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useOrg } from "@/lib/org-context";
import { apiFetch } from "@/lib/api";
import { MCP_TOOL_DOCS } from "@/lib/mcp/tool-docs";
import { Bot, Check, Copy, Link2, ShieldCheck, Terminal, Trash2, Monitor } from "lucide-react";

function CopyField({ label, value, mono = true }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Klembord geweigerd: de waarde staat er nog om handmatig te kopiëren.
    }
  }
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 min-w-0 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm break-all ${mono ? "font-mono" : "font-sans"}`}
        >
          {value}
        </code>
        <button
          onClick={copy}
          className="flex-shrink-0 p-2 rounded-xl border border-gray-200 text-gray-500 hover:text-brand-black hover:bg-gray-50"
          title="Kopiëren"
        >
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-brand-black mb-4">
        {Icon && <Icon className="w-4 h-4 text-brand-orange" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ConnectionsTable({ connections, showUser, onRevoke }) {
  if (!connections) return <p className="text-sm text-gray-400">Laden…</p>;
  if (!connections.length) return <p className="text-sm text-gray-400">Geen actieve koppelingen.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400">
            {showUser && <th className="py-2 pr-4 font-medium">Gebruiker</th>}
            <th className="py-2 pr-4 font-medium">Client</th>
            <th className="py-2 pr-4 font-medium">Gekoppeld op</th>
            <th className="py-2 pr-4 font-medium">Laatst gebruikt</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {connections.map((c) => (
            <tr key={c.id} className="border-t border-gray-100">
              {showUser && <td className="py-2 pr-4">{c.user_name}</td>}
              <td className="py-2 pr-4 font-medium">{c.client_name}</td>
              <td className="py-2 pr-4 text-gray-500">{formatDate(c.created_at)}</td>
              <td className="py-2 pr-4 text-gray-500">{formatDate(c.last_used_at)}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => onRevoke(c)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Intrekken
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function McpContent() {
  const { user, organization, tenant, isAdmin } = useOrg();
  const [origin, setOrigin] = useState("https://crm.48-7.nl");
  const [mine, setMine] = useState(null);
  const [org, setOrg] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function load() {
    setError("");
    try {
      const res = await apiFetch("/api/account/connections");
      const data = await res.json();
      setMine(data.connections || []);
      if (isAdmin) {
        const orgRes = await apiFetch("/api/account/connections?scope=org");
        const orgData = await orgRes.json();
        setOrg(orgData.connections || []);
      }
    } catch {
      setError("Koppelingen konden niet worden geladen");
    }
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  async function revoke(connection) {
    const who = connection.user_name && connection.user_id !== user?.id ? ` van ${connection.user_name}` : "";
    if (!confirm(`Koppeling met ${connection.client_name}${who} intrekken? Claude heeft daarna geen toegang meer tot het CRM tot er opnieuw wordt ingelogd.`)) return;
    const res = await apiFetch(`/api/account/connections?id=${connection.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Intrekken mislukt");
    }
    load();
  }

  const mcpUrl = `${origin}/api/mcp`;
  const cliCommand = `claude mcp add --transport http 48-7-crm ${mcpUrl}`;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-black">
          <Bot className="w-6 h-6 text-brand-orange" /> Claude koppelen
        </h1>
        <p className="text-sm text-gray-500 mt-2">
          Met de CRM-connector werk je vanuit Claude (claude.ai, Claude Desktop of Claude Code) direct in het CRM:
          leads opzoeken, relaties en contacten toevoegen (bijvoorbeeld uit je mail), notities en to-do&apos;s vastleggen, trajecten bijwerken en conceptoffertes maken. Claude
          werkt daarbij <strong>als jou</strong>: alleen binnen {organization?.display_name || "je eigen organisatie"},
          en alles wat Claude aanmaakt of wijzigt staat op jouw naam.
        </p>
      </div>

      <Section title="Gegevens voor de koppeling" icon={Link2}>
        <div className="space-y-4">
          <CopyField label="Connector-URL (Remote MCP server URL)" value={mcpUrl} />
          <CopyField label="Naam (vrij te kiezen)" value="48-7 CRM" mono={false} />
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Inloggen met</p>
              <p>Je CRM-e-mailadres en pincode</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Client-ID / client secret</p>
              <p>Leeg laten — Claude registreert zichzelf</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Jouw account</p>
              <p>{user?.name} · {user?.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Organisatie</p>
              <p>{organization?.display_name} <span className="text-gray-400">({tenant})</span></p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Zo koppel je Claude" icon={Monitor}>
        <div className="space-y-5 text-sm">
          <div>
            <h3 className="font-semibold mb-2">claude.ai en Claude Desktop</h3>
            <ol className="list-decimal pl-5 space-y-1 text-gray-700">
              <li>Ga naar <strong>Instellingen → Connectors</strong> (op claude.ai of in de desktop-app; dezelfde lijst).</li>
              <li>Kies <strong>Custom connector toevoegen</strong>.</li>
              <li>Vul als naam <em>48-7 CRM</em> in en plak de connector-URL hierboven. Geavanceerde instellingen leeg laten.</li>
              <li>Klik op <strong>Toevoegen</strong> en daarna op <strong>Verbinden</strong>. Er opent een CRM-inlogscherm.</li>
              <li>Log in met je e-mail en pincode en klik op <strong>Toegang geven</strong>.</li>
              <li>Zet in een gesprek de connector aan via het <strong>+</strong>-menu (Connectors) en vraag bijvoorbeeld: <em>&quot;Wat staat er op mijn to-do-lijst in het CRM?&quot;</em></li>
            </ol>
            <p className="text-xs text-gray-400 mt-2">
              Werk je in een Team- of Enterprise-omgeving, dan moet een beheerder custom connectors mogelijk eerst toestaan.
            </p>
          </div>
          <div>
            <h3 className="flex items-center gap-2 font-semibold mb-2"><Terminal className="w-4 h-4" /> Claude Code</h3>
            <ol className="list-decimal pl-5 space-y-1 text-gray-700">
              <li>Voer in je terminal uit:</li>
            </ol>
            <div className="mt-2"><CopyField label="Commando" value={cliCommand} /></div>
            <ol start={2} className="list-decimal pl-5 space-y-1 text-gray-700 mt-3">
              <li>Start Claude Code, typ <code className="font-mono">/mcp</code>, kies <em>48-7-crm</em> en dan <strong>Authenticate</strong>.</li>
              <li>Log in de browser in met e-mail en pincode.</li>
            </ol>
          </div>
        </div>
      </Section>

      <Section title="Wat Claude kan" icon={Bot}>
        <div className="divide-y divide-gray-100">
          {MCP_TOOL_DOCS.map((t) => (
            <div key={t.name} className="py-3 grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 text-sm">
              <div>
                <p className="font-medium">{t.label}</p>
                <p className="text-xs text-gray-400 font-mono">{t.name}</p>
              </div>
              <div>
                <p className="text-gray-700">{t.description}</p>
                <p className="text-xs text-gray-400 mt-0.5">Bijv. &quot;{t.example}&quot;</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Veiligheid en veelgestelde vragen" icon={ShieldCheck}>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">Wat ziet Claude?</dt>
            <dd className="text-gray-600">Alleen de gegevens van {organization?.display_name || "je eigen organisatie"}. Een koppeling hoort bij één account; werk je voor meerdere organisaties, koppel dan per account apart.</dd>
          </div>
          <div>
            <dt className="font-medium">Hoe lang blijft de koppeling geldig?</dt>
            <dd className="text-gray-600">Claude krijgt een toegangssleutel van 1 uur die zichzelf vernieuwt. Wordt de koppeling 30 dagen niet gebruikt, dan log je opnieuw in. Je pincode wordt niet aan Claude gegeven.</dd>
          </div>
          <div>
            <dt className="font-medium">Hoe stop ik de toegang?</dt>
            <dd className="text-gray-600">Trek de koppeling hieronder in, of verwijder de connector in Claude. Een gedeactiveerd CRM-account verliest direct alle toegang.</dd>
          </div>
          <div>
            <dt className="font-medium">&quot;Je moet eerst je startpincode wijzigen&quot;</dt>
            <dd className="text-gray-600">Log eerst gewoon in op het CRM, kies een eigen pincode en koppel daarna opnieuw.</dd>
          </div>
          <div>
            <dt className="font-medium">Limieten</dt>
            <dd className="text-gray-600">Dezelfde limieten als in het CRM zelf. Na vijf verkeerde pincodes is je account een kwartier geblokkeerd. Bijlagen via Claude mogen maximaal 3 MB zijn; grotere bestanden upload je in het CRM.</dd>
          </div>
          <div>
            <dt className="font-medium">Contacten uit mijn mail toevoegen?</dt>
            <dd className="text-gray-600">Koppel in Claude ook je mail (Gmail of Outlook) en vraag bijvoorbeeld &quot;scan mijn mail van deze week op nieuwe zakelijke contacten&quot;. Claude zoekt eerst of het bedrijf al bestaat en laat een voorstel zien; pas na jouw akkoord worden relaties aangemaakt, standaard buiten de pipeline en zonder nieuwsbrief. De nieuwsbrief gaat alleen aan met een reden, zoals &quot;bestaande klant&quot; of &quot;vroeg erom&quot;.</dd>
          </div>
          <div>
            <dt className="font-medium">Offertes versturen?</dt>
            <dd className="text-gray-600">Claude maakt alleen conceptoffertes. Opmaken, controleren en versturen doe je in het CRM.</dd>
          </div>
        </dl>
      </Section>

      <Section title="Mijn koppelingen" icon={Link2}>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <ConnectionsTable connections={mine} onRevoke={revoke} />
      </Section>

      {isAdmin && (
        <Section title={`Koppelingen in ${organization?.display_name || "je organisatie"}`} icon={ShieldCheck}>
          <p className="text-xs text-gray-400 mb-3">Als admin kun je koppelingen van collega&apos;s intrekken.</p>
          <ConnectionsTable connections={org} showUser onRevoke={revoke} />
        </Section>
      )}
    </div>
  );
}

export default function McpPage() {
  return (
    <AppShell>
      <McpContent />
    </AppShell>
  );
}
