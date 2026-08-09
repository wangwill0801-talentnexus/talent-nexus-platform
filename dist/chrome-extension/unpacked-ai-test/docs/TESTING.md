# Testing — Connector v1 RC

Run from `working/`. Requires `NODE_PATH=C:\tn104env\node_modules` (jsdom).

## Focused (new this phase)
- `test/connector-options.spec.js` — Interface Language: zh-TW/en presets,
  Custom preservation, authoritative `config.api` writes, no `/webapp/`,
  MV3 no-inline-script, TN label localization, Pinpin Options preserved.

## Active regression suites
- `test/tnai.spec.js` (AI Fill integrated)
- `test/tnai-launcher.spec.js` (permanent launcher)
- `test/tnai-104-input.spec.js` (104 input + B3 one-retry guard)
- `test/site104.spec.js`
- `test/site104.identity.spec.js`
- `test/tnai-linkedin-text.spec.js`
- `test/tnai-ainote-v2.spec.js`
- `test/tntrace.spec.js`
- `test/tntrace.diff.spec.js`

All 10 suites green as of RC (466 assertions, 0 failures).

## Out of scope (do not repair during initial audit)
- `test/tnai-linkedin.spec.js` — pre-existing jsdom harness failure on frozen
  LinkedIn capture; not a product regression from this phase.
