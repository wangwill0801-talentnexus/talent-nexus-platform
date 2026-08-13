# Candidate Evidence Model

## Boundary

Evidence, deterministic extraction, AI interpretation, ATS baseline and UI presentation are separate layers. The ATS remains the operational source; TN never writes Pinpin and never reads `Annex` or `Annex1` BLOBs.

## Durable contract

- Candidate identity: immutable TN UUID plus exact scoped external reference `pinpin / pinpin-prod / ZPResumeInfo.ID`.
- Evidence row: source kind/system/reference/URL, attachment metadata, capture time and SHA-256 when supplied by an approved capture path.
- Extraction row: evidence ID, extractor version, representation kind, content SHA-256, character count and status.
- AI snapshot: immutable versioned `standard_resume_v1` payload with parser/schema/provider/model provenance.
- Projection: rebuildable views of the immutable snapshot. Projection rows are not evidence.

`metadata_only` evidence is deliberately `processing_eligible=false`. An existing Connector/Netlify result is recorded as a completed legacy processing event; TN does not pretend that metadata alone is processable resume content and does not invoke Gemini a second time.

## Approved representations

`connector_text`, `connector_html`, and `local_file_text` may become eligible only when their deterministic representation and fingerprint are verifiable. Hidden API scraping, cookies/tokens, name-based correlation and ATS BLOB access are prohibited. Zero or ambiguous identity/evidence matches fail closed.
