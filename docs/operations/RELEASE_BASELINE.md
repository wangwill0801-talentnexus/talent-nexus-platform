# Talent Nexus Release Baseline

## Baseline scope

This baseline records the production-proven Candidate Intake Foundation before
Candidate Evidence & AI Processing work begins.

- TN API source and migrations: `services/tn-api/`
- Architecture and operational evidence: `docs/`
- Current production migrations: `001`, `002`, `003`
- Validated Node.js runtime: `24.18.0`
- Current Connector release contract: `5000.0.115 Entra Side-car`
- Production Candidate Intake evidence: existing candidate `43198` and fresh
  Connector/ATS candidate `43219`, both PASS
- Full TN API automated suite at the preceding production gate: `55/55 PASS`

## Source versus artifact

- Connector source is `working/`; `unpacked-ai-test` and ZIP/CRX files are
  artifacts used for loading and distribution.
- TN API source is `services/tn-api/`; `services/tn-api/dist/` and
  `E:\TalentNexus\tn-api` are generated/deployed outputs.
- Netlify deploy source is `_backend_publish_worktree/`; the root
  `ai-page-netlify/` tree requires explicit reconciliation before use.

## Reconstruction

The TN API is reconstructed from the root repository source using the locked
`package-lock.json`, the validated Node major runtime, `npm ci`, TypeScript
build and the reviewed migration/deployment runbook. Native `msnodesqlv8`
packaging must be verified explicitly because one prior package omitted its
prebuilt native binary.

The current Connector cannot yet be deterministically reconstructed from a
clean commit because its active 5000.0.115 implementation remains dirty in the
nested repository. Its loaded runtime is byte-aligned with `working` for the
critical files, but a separate Connector release-baseline commit remains a
known follow-up and is not required to build the TN backend processing layer.

## Rollback points

- Source rollback: the focused local root baseline commit created for this
  phase, plus the pre-baseline root HEAD `c5537e1`.
- Database rollback: the existing PostgreSQL native backup/restore procedure;
  a new pre-migration native backup is mandatory before a production schema
  change.
- Runtime rollback: retain the immediately previous validated
  `E:\TalentNexus\tn-api` package and scheduled-task configuration.
- Connector/Netlify rollback: unchanged by this phase unless separately
  authorized and recorded.

## Permanent gates

- Pinpin writes: zero.
- Annex/Annex1/BLOB reads: zero.
- Candidate identity: immutable TN UUID plus scoped exact ATS Candidate ID.
- No name/email/phone automatic merge.
- No secret in source, history, logs or reports.
- No DNS, IIS, Entra or firewall change without an explicit gate.

## Remote and off-machine status — 2026-08-13

- Active source branch: `codex/tn-evidence-processing-foundation`.
- Evidence/processing foundation report commit after the approved history cleanup: `e6ee1fa`; historical pilot report commit: `45b1ac3`.
- Root remote: `https://github.com/wangwill0801-talentnexus/talent-nexus-platform.git`.
- The active branch was pushed successfully without force to the dedicated `talent-nexus-platform` repository.
- A tracked private-key artifact at `dist/talent-nexus-104-poc.pem` was removed from every rewritten commit before the first GitHub push. The rewritten history was scanned for private-key markers, common GitHub/Google token patterns and suspicious credential filenames with zero findings.
- A verified full pre-clean bundle and the quarantined key remain only under the ACL-restricted local path `C:\TN-Secrets\git-history-backups\talent-nexus-platform-20260813_182503`; this backup must never be uploaded or distributed.
- Existing dirty/untracked Connector, Netlify and distribution work was preserved byte-for-byte at the tracked-diff level during the metadata replacement.
- Production has the deployed runtime and native PostgreSQL backups, but these are not a substitute for an off-machine source repository.
