# Pinpin Browser Evidence Bridge

Talent Nexus treats Pinpin as a read-only source. The VPS reads candidate and
attachment metadata through the existing read-only SQL adapter; it never reads
resume BLOB columns and never writes Pinpin.

For content, the consultant's current authenticated ATS browser session is the
security boundary:

```text
Pinpin SQL metadata (read-only)
        -> TN evidence request (scoped Pinpin ID + attachment metadata)
        -> Connector validates the current ATS candidate
        -> Connector fetches only the requested /rest/file/preview/CVxxxx
        -> Connector sends normalized text through candidate_evidence_intake_v1
        -> TN hashes, deduplicates, processes and refreshes the AI Profile
```

`CV` references are deterministic (`CV` + `ZPResumeInfo_Annex_Other.ID`).
Known original-resume names in both Traditional and Simplified Chinese are
high-confidence Pinpin-imported resumes. Images are not primary resume
evidence, and recommendation reports remain separate recruiter/submission
evidence.

The Connector sends no Pinpin credentials, cookies or authorization headers to
TN. Candidate ownership is checked against the scoped ATS Candidate ID before
any attachment request. Ambiguous candidate or resume selection fails closed
with `needs_review`.
