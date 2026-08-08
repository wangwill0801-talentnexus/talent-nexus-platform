# Branding — Talent Nexus Connector

## Product name
- Extension: **Talent Nexus Connector**
- Feature: **AI Resume Review**
- Manifest `name`: `Talent Nexus Connector`
- Manifest `action.default_title`: `Talent Nexus Connector`

## Visual source of truth
- Provided: `talent-nexus-connector-icon-master-512.png` (dark circle, electric-blue
  TNT monogram, minimalist, enterprise SaaS).
- Chrome-ready set shipped in the ZIP: `icon16/32/48/128.png` (+`icon256.png`,
  `icon512/master-512`).
- **No redesign, no alt logo, no product text baked into the icon** (per master
  prompt §5). The supplied artwork is used as-is.

## Icon installation
- `working/icons/{icon16,icon32,icon48,icon128}.png` ← from supplied ZIP.
- `working/assets/branding/talent-nexus-connector-icon-master-512.png` (preserved).
- `dist/ai-page-netlify/public/favicon.png` (icon32) + `public/assets/branding/master-512`.
- Manifest `icons` + `action.default_icon` updated to the four-size set.

## Toolbar inspection (honest)
- 128/48/32 render cleanly (dark bg, blue TNT).
- **16px**: vision review shows the monogram reads as **"TN"** — the interlocked
  third "T" merges at this size. This is the brand's own downscaled export, so we
  kept it (§5 forbids redesign). Flagged as a manual eyeball item: inspect in a
  real Chrome toolbar before shipping; if it looks like a blob, ask design for a
  16px-optimized cut (simplify foot-cuts only) — do NOT change the TNT concept.

## Color system
- Chrome AI panel + Netlify page share one palette:
  - bg `#0b1020`, panel `#121a32`, panel2 `#0e162a`, border `#27406e`
  - accent `#3b82f6` / `#60a5fa`, ink `#e8eefc`, muted `#8aa0c8`
- Replaces the earlier teal/green test styling.

## Files
- `working/icons/*`, `working/assets/branding/*`
- `dist/ai-page-netlify/public/favicon.png`, `public/assets/branding/*`
- (icon references in `manifest.json`, `public/index.html`, `public/ai-review.html`,
  `js/versions/v1/sites/tnai.js`)
