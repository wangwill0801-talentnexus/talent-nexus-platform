# Handoff

Self-grade: **prototype -> production candidate, pending authenticated testing.**
The diff is surgical and unit-verified; nothing has met a live Pinpin session.

## Immediate next step
Run `docs/LINKEDIN_REGRESSION.md` (L1-L10) then `docs/MANUAL_TEST_104.md`
(T1-T15) on the office machine. Everything else waits on T8 (parse quality) and
T12 (remark isolation).

## Roadmap, in order
1. **MutationObserver for the 104 Vue SPA.** The inherited 2 s timer is the
   biggest functional gap (T13). Scope the observer to 104 only so the golden
   path keeps its existing timing.
2. **Tune the capture container** based on real T8 results — narrower, not wider.
3. **Site Adapter registry.** The two `if/else` chains in `page.js` are the
   structural debt. Collapse them into a table of `{match, capture, import}`
   adapters, migrating 104 first and leaving LinkedIn last.
4. Masked-contact duplicate experiment (only after the primary flow is proven).
5. Standard `linkedin.com/in` improvements, then the wider Resume Gateway plan.

## Out of scope, deliberately not done
MV2->MV3 migration (base is already MV3), AI/Gemini/HY3 resume parsing,
Supabase/DB/RAG, new backend or auth, React/Vue/TS/Vite, 1111, Cake.

## Repo layout
```
original/plugin-5english.crx     untouched
working/                         git repo, baseline commit = pristine base
  js/versions/v1/sites/site104.js   the adapter
  test/site104.spec.js              67 tests
dist/unpacked/                   load-unpacked target (no test/, no .git)
dist/talent-nexus-104-poc-source.zip
docs/
```
`git diff baseline` inside `working/` is the authoritative change set.

## Re-verifying after any future change
```bash
cd ~/Desktop/TalentNexus-104-Golden
node "%LOCALAPPDATA%\hermes\skills\software-development\chrome-extension-integration\scripts\verify_shipped_build.js" \
  --root "C:\Users\William Wang\Desktop\TalentNexus-104-Golden" \
  --spec test/site104.spec.js \
  --node-path "C:\tn104env\node_modules" \
  --markers verify-markers.json
```
Re-runs the 67 jsdom assertions, then re-proves every marker in
`verify-markers.json` exists in **both** `dist/unpacked` and the packaged CRX
bytes, and that the git diff never touches background/auth/LinkedIn files.
Exit 0 = all green. Repack the CRX before running it, or you verify stale bytes.

This is **ad-hoc verification of this change set, not a project test suite** —
the legacy tree has no `package.json`, no test script and no CI.
