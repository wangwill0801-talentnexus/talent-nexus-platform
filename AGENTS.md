# Talent Nexus permanent engineering invariants

- Legacy ATS / Pinpin is read-only to TN. Never write its database or read resume BLOBs during routine sync.
- TN candidate UUID is immutable. The consultant-facing operational number is the verified ATS Candidate ID.
- Candidate identity is the scoped external tuple; never auto-merge by name, email or phone.
- Evidence, AI interpretation and ATS presentation are separate data lines.
- AI must not silently overwrite or save ATS data.
- Preserve Connector release history; candidate foundation work must not absorb unrelated Job/Company features.
- Production IIS, DNS, Entra, secrets and destructive migrations require an explicit gate.
- Keep the Connector light: capture/package evidence and complete the ATS workflow; deep parsing, normalization, enrichment, replay and historical processing belong in the TN backend/VPS worker boundary.
