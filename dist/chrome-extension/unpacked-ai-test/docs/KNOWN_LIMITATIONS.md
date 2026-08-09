# Known Limitations — Connector v1 RC

## AI Note v2 (ACCEPTED, non-blocking)
- Gemini may occasionally return a shallow `recruiterSummary` (title/company
  metadata) and `targetRoles` may sometimes be absent.
- Root cause: model output variance on some resumes; one retry contract already
  in place (replaces only summary/roles/keywords).
- Decision: do NOT fix in RC. Future optimization belongs to Codex / TNT
  production integration using accumulated real recruiter examples.
- FROZEN: backend prompt, model, retry, quality-gate quotas are out of scope.

## Interface Language
- Connector i18n localizes Talent Nexus-owned UI only (brand, subtitle, AI Fill,
  Options labels, helper text). Native Pinpin field labels / dropdown options /
  candidate data are NEVER translated.
- Switching ATS endpoint to change native Pinpin language may require an ATS
  reload to fully apply (acceptable; we show a "reload to apply" note, no
  destructive forced reload).

## New Talent resize
- Implemented as a minimal JS grip (CSS `resize:both` proved unreliable live in
  Chrome MV3 content world). Uses real width/height, no transform:scale().

## Capture
- LinkedIn capture is frozen legacy code; pre-existing jsdom harness test
  (`tnai-linkedin.spec.js`) is out of scope — do not repair it during audit.

## Backend
- Netlify function unchanged in this UI phase. Gemini key server-side only.
