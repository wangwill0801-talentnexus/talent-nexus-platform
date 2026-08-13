# Pinpin HTTPS Hardening

## Phase 6B.2A-1.5 - 2026-08-12

## Scope and preserved boundaries

This phase added trusted HTTPS only for the existing Pinpin ATS hostnames. It
did not modify Pinpin application code, application pools, database data, SQL
Server configuration, Plugin code, Entra, TN API behavior, Gemini, or the
existing `tn-api.talentnexus.com.tw` edge.

| Site | Existing HTTP | New HTTPS |
| --- | --- | --- |
| Chinese ATS | `http://ats.talentnexus.com.tw:5679/webapp/` retained | `https://ats.talentnexus.com.tw/webapp/` added |
| English ATS | `http://ats-en.talentnexus.com.tw:5678/webapp/` retained | `https://ats-en.talentnexus.com.tw/webapp/` added |

HTTP-to-HTTPS redirect is **NOT ENABLED**. HSTS is **NOT ENABLED**.

## IIS and certificate approach

- Existing Chinese and English Pinpin IIS sites, their HTTP 5679/5678 bindings,
  host headers, and application pools were preserved.
- SNI HTTPS bindings were added to those same respective Pinpin sites:
  `*:443:ats.talentnexus.com.tw` and
  `*:443:ats-en.talentnexus.com.tw`.
- Separate trusted Let's Encrypt production certificates were issued for the
  two exact ATS hostnames. No wildcard or TN API certificate was replaced.
- The existing win-acme scheduled task remains `Ready`. It has persistent
  renewal configuration for both ATS certificates.
- A separate static IIS site, `TalentNexusAtsAcmeChallenge`, serves only the
  HTTP-01 challenge path for the two ATS hostnames. Its extensionless
  `text/plain` MIME mapping is limited to that site because ACME token files
  have no filename extension. It does not proxy to Pinpin, alter Pinpin's
  bindings, or rewrite application traffic.

The hostnames on standard HTTP port 80 previously returned 404 for `/webapp/`
and still return 404. This is intentional: the compatibility HTTP applications
remain at their existing explicit ports 5679 and 5678, which remain HTTP 200.

## Verification

- Both ATS DNS records resolve to `103.144.32.63`.
- Both HTTPS `/webapp/` endpoints return 200 with normal public TLS hostname
  validation.
- Both legacy HTTP `/webapp/` endpoints return 200.
- No `Strict-Transport-Security` header was detected.
- The returned application entry pages contain no detected absolute `http://`
  script or stylesheet references.
- TN public and local health endpoints return 200.
- Fastify remains `127.0.0.1:3333`; PostgreSQL remains `127.0.0.1:5432`.
- Public TCP access to 3333, 5432 and 1433 remains unavailable.
- PostgreSQL, W3SVC and MSSQLSERVER remain running.
- TN TypeScript build passed; automated tests passed 31/31.

## Plugin compatibility finding

**Plugin modification: NOT IMPLEMENTED.** Static inspection of the deployed
Connector source shows its ATS recognition, host permissions and generated ATS
links are explicitly limited to `http://` plus port 5679/5678. It continues to
recognize the retained legacy HTTP URLs, but it does not recognize the new
standard HTTPS ATS URLs. No Plugin change was made in this phase, as required.

This is a controlled compatibility gap, not a Pinpin application failure. A
future separately approved Plugin phase may add the HTTPS host permissions and
source recognition after validating the Chrome extension release path.

## Future boundary

- Entra: **NOT MODIFIED**
- Plugin HTTPS recognition: **NOT IMPLEMENTED**
- HTTP to HTTPS migration: **NOT STARTED**
- HSTS: **NOT STARTED**
- No Pinpin database write occurred.

**PHASE 6B.2A-1.5 PINPIN HTTPS HARDENING REVIEW REQUIRED.**
