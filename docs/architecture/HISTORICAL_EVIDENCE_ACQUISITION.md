# Historical Evidence Acquisition Contract

## Status

The TN backend bridge is deployed. It accepts content-backed evidence for an existing TN candidate only when the request supplies the exact scoped Pinpin identity `(pinpin, pinpin-prod, numeric ATS Candidate ID)`. It never creates or merges a candidate from name, email, phone, LinkedIn URL or 104 code.

The public Connector-facing route is `POST /api/v1/plugin-sidecar/candidate-evidence` and reuses the existing Microsoft Entra resource-server validation and `TN.Sidecar.Write` scope. The internal bearer route is retained for controlled diagnostics. Neither response nor application logs contain evidence text.

## Evidence contract

Supported source kinds are 104 resume, LinkedIn Public, LinkedIn Recruiter, PDF, DOCX, HTML and approved Connector capture. The server:

1. verifies the exact candidate external reference;
2. canonicalizes supported URLs and strips query/fragment tracking data;
3. normalizes extracted text with version `tn-text-nfkc-v1` (Unicode NFKC, LF line endings, normalized non-breaking/inline whitespace and bounded blank lines);
4. calculates SHA-256 server-side and rejects a mismatching client hash;
5. derives an immutable evidence identity from candidate, source reference and content hash;
6. persists normalized text as the controlled reprocessing representation, never as a log or API response;
7. reuses a supplied valid `standard_resume_v1` without another Gemini call, otherwise queues `process_new_evidence` for the existing low-concurrency worker.

Same candidate/source/content replay is a no-op. Changed normalized content creates a new immutable evidence/snapshot lineage. Source URLs never contain tokens or tracking parameters. Original PDF/DOCX binaries remain outside TN; no Pinpin Annex/Annex1 access is used.

## Processing

The deployed worker uses the existing server-side Gemini provider. It validates structured output through the Standard Resume schema, creates an immutable snapshot, rebuilds normalized projections and links the evidence atomically. Provider transport failures use bounded queue retry; missing configuration or invalid output fails closed to review. Projection rebuild and content-backed processing share the same projection implementation.

## Current operational boundary

The backend bridge is production-ready, but the current Connector source tree contains substantial pre-existing uncommitted release work. This build therefore did not overwrite or release a new Connector binary. A recruiter-facing no-ATS-save capture trigger must be integrated only after that Connector source is first consolidated into a clean, reproducible release baseline.
