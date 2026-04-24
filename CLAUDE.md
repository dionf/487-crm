# 48-7 CRM (487crm)

Dit is de **eigen CRM van 48-7 AI Professionals** — een Next.js applicatie met Supabase backend.
Dit is NIET HubSpot. Als de gebruiker "CRM", "487crm", "48-7 crm", "leads" of "offertes" zegt, gaat het over DIT project.

## Stack
- **Frontend**: Next.js 14 (App Router) op Vercel
- **Backend**: Supabase (project `olzyffwotjtyvupomoiz`)
- **AI**: Anthropic Claude API (email intake + bedrijfsanalyse + offerte-advies)
- **URL**: https://487crm.vercel.app / https://crm.48-7.nl

## Belangrijke mappen
- `app/api/` — API routes (leads, notes, quotes, attachments, poll-inbox)
- `app/leads/` — Lead detail pagina's
- `components/` — React componenten (LeadForm, NoteForm, QuoteForm, etc.)
- `lib/` — Supabase client, constants, utils

## Database tabellen
- `leads` — Bedrijven/contacten met status pipeline
- `notes` — Notities, todo's, gesprekken, intern
- `quotes` — Offertes met nummering
- `activities` — Activiteiten timeline
- `attachments` — Bijlagen (Supabase Storage)
- `lead_inbox_log` — Email intake logging

## Features
- PIN-beveiligd dashboard (2025)
- Email-to-lead intake via IMAP polling (leads@48-7.nl)
- AI bedrijfsanalyse per lead
- Zoekfunctie in header
- Todo overzicht per gebruiker

## Multi-Tenant Uitbreiding
Zie PRD-multi-tenant.md voor de volledige specificatie.
Tech stack: Next.js, Supabase (project: olzyffwotjtyvupomoiz), Vercel.
Werk de fases sequentieel af. Begin met Fase 1 (database & auth).
