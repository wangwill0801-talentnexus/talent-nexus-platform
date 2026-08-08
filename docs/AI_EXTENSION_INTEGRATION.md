# Chrome Extension AI Integration

- `tnai-schema.js` — Standard Resume JSON schema + anonymized mock.
- `tnai.js` — additive content script (ISOLATED world). Floating `[✨ AI Review]`
  panel, mock-mode parse, per-candidate state, drives the bridge.
- `tnai-bridge.js` — MAIN-world injected script; owns the canonical save
  (window.__TNAI_BRIDGE: findScope / applyIdentity / submitSave).
- Prompted by the 104 import flow (site104) or manually via TNAI.renderPanel.

The AI panel is injected into the Pinpin New Talent page. page.js / the webapp
controller are NOT modified. Single config point: AI_API_BASE_URL (settable via
TNAI.setApiBaseUrl or localStorage `tnai_api_base_url`).

Regression: Original Save, LinkedIn capture, 104 capture, identity selection
are all unchanged. AI is additive.
