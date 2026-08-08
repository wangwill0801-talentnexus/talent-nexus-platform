# Changelog

All work is against the immutable golden base `plugin-5english.crx`
(v5000.0.108, MV3). `original/plugin-5english.crx` is byte-for-byte unchanged.

## 104 POC

### Fixed — wrong candidate identity (critical)
`capture104Resume()` picked the summary card with `querySelector`, i.e. the
**first** card in the 104 result list, not the opened candidate. Candidate B's
name and phone led the parser payload, so Pinpin created candidate B while the
recruiter was viewing candidate A. Replaced with `findOpenCandidateCard()`
(id-match -> active class -> aria-selected -> URL id -> omit summary when
ambiguous). Reproduced and covered by `test/site104.identity.spec.js` (36
assertions, mutation-tested). See `docs/104_ROOT_CAUSE.md`.

### Added
- `js/versions/v1/sites/site104.js` — 104 detection + capture (additive `window.TN104`)
- `findOpenCandidateCard()` and `cardPick=` diagnostic
- `resolveApiHost()` — matches the legacy bare `Config.api` resolution
- Diagnostic tracer `tntrace.js` / `tntrace_sw.js` (**diagnostic build only**)
- Specs: `site104`, `site104.identity`, `tntrace`, `tntrace.diff` — 303 assertions

### Changed
- `js/versions/v1/default/page.js` — 3 insertions, 0 deletions
  (matchUrl entry, `TN104.isResumePage()` gate, 104 capture branch)
- `manifest.json` — 104 host permission, adapter script, `update_url` removed

### Unchanged
LinkedIn code paths, service-worker architecture, Pinpin authentication and
session recovery, request layer, storage, permissions model.

## Known limitations
- 104 is a Vue SPA: switching candidate without a reload does not re-trigger
  the automatic duplicate check (legacy 2s timer). Use the precise button.
  Fixing properly needs a MutationObserver.
- Capture omits `<head>`/styles and contact sentinel markers that LinkedIn
  includes. May affect parser quality — see `docs/CAPTURE_PARITY_LINKEDIN_104.md`.
- No section expansion for collapsed 104 work history.
- `/company/status/switchCompany` 404 seen previously is unexplained and
  untriaged; not shown to be extension-originated.

## Verification status
STATIC VERIFIED and unit-tested only. **No live authenticated test of 104,
Pinpin or LinkedIn has been performed.**
