# AI Architecture

Two deliverables, one shared data model (Standard Resume JSON).

```
104 / LinkedIn
      ↓ existing capture (site104.js / LinkedIn branch)
      ↓ existing Pinpin Parser → New Talent (a.resume)
      │
      ├─ ORIGINAL ──────→ existing fields → Original Save (a.submit) ──→ Pinpin
      │
      └─ AI REVIEW ─────→ Chrome AI module (tnai.js, isolated world)
                            → Netlify API (resume-ai-parse)
                            → Gemini (server-side key)
                            → Standard Resume JSON
                            → AI Review form (editable)
                            → tnai-bridge.js (MAIN world)
                            → SAME a.resume + a.submit(true) ──→ Pinpin
```

Constraints honored:
- ONE canonical Save (`request.api.submit` / addbyplug). No second client.
- Gemini key server-side only; never in extension, page, or source.
- AI state per-candidate (run id); isolated between imports.
- Original New Talent never auto-modified by AI.
- Stateless backend; no DB.

Files: see AI_PINPIN_FIELD_MAPPING.md and CODEX_HANDOFF_AI.md.
