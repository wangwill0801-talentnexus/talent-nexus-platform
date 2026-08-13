# Talent Nexus Repository Ownership

## Purpose

This document fixes the source-of-truth boundary without restructuring the
existing workspace. It is intentionally conservative because the workspace
contains several independent repositories and historical unpacked releases.

## Ownership

| Component | Authoritative source | Repository owner | Artifact / mirror |
| --- | --- | --- | --- |
| TN API, PostgreSQL migrations, worker and processing foundation | `services/tn-api/` | root `TalentNexus-104-Golden` repository | production deployment at `E:\TalentNexus\tn-api` |
| Architecture, operations, roadmap and production reports | `docs/` | root repository | exported SOP documents are deliverables, not executable source |
| Chrome Connector | `working/` | nested Connector repository | `dist/chrome-extension/unpacked-ai-test/` is the loaded test runtime; ZIP/CRX folders are release artifacts |
| Netlify Gemini parser and PDF workspace | `_backend_publish_worktree/` | `talent-nexus-ai-api` repository | root `ai-page-netlify/` is a historical/local mirror and must not be treated as the deploy source without an explicit synchronization review |
| Original Pinpin Connector baseline | `original/` | root historical baseline | immutable comparison source |

## Rules

1. Never use `git add .` from the root workspace.
2. Never commit `node_modules`, compiled `dist`, local phase snapshots, logs,
   runtime environment files, private keys, tokens or database credentials.
3. Connector changes follow `working` source -> focused tests -> package ->
   unpacked parity. Never patch only an unpacked/ZIP artifact.
4. TN API changes follow `services/tn-api` source -> tests/build -> reviewed
   migration/package -> production deployment. The production directory is
   not a source repository.
5. Netlify changes must be made and committed in `_backend_publish_worktree`
   after reconciling any intentional local mirror changes.
6. Release artifacts record source commit, version, build method, SHA-256 and
   release date. Artifacts are not authoritative source.
7. Existing dirty/untracked Connector and Netlify work is user work and must
   not be cleaned, reset, moved or committed as part of a TN API change.

## Current repositories

- Root: branch `master`, pre-baseline HEAD `c5537e1`, no configured remote.
- Connector: branch `feature/ai-resume-review`, HEAD `ecf8de4`; dirty working
  tree contains the active 5000.0.115 implementation.
- Netlify publish worktree: branch `main`, HEAD `de0b04c`, origin
  `wangwill0801-talentnexus/talent-nexus-ai-api`; dirty working tree contains
  current PDF workspace presentation changes.

The root baseline commit is a local engineering rollback point. Publishing or
moving it to a remote requires a separate repository/remote decision.
