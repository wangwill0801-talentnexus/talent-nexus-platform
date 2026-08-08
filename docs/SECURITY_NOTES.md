# Security & privacy notes

## Data handling

The extension processes only what is already visible in the recruiter's
authenticated browser session. It does not:

- unlock 104 contact details or consume 104 credits
- call hidden/private 104 APIs
- reveal masked phone/email
- bypass access control or CAPTCHA
- automate login

## Logging

Allowed: booleans, counts, lengths, HTTP status, selector/mode names,
`cardPick` reason, run counter, timing.

Never logged: candidate name, phone, email, resume HTML or text, temp
filename, Pinpin host, cookies, `loginparam`, tokens.

Enforced by an **AST-based** scan in `test/tntrace.spec.js` (acorn): comments
are excluded via `onComment` ranges, then executable code is checked for banned
identifiers, and every string literal is walked for PII field names.
Mutation-tested — a real leak in code fails, the same words in a comment pass.

## Internal recruiter remarks

104 pages may carry remarks written by other recruiters, sometimes containing
their own names or old contact numbers. `REMARK_SELECTORS` content is stripped
from the parser payload and kept separately as `internalRemarkText`. A
recruiter's name must never be parsed as the candidate's.

## Candidate identity safety

`findOpenCandidateCard()` fails **closed**: if it cannot prove which candidate
is open, it omits the summary rather than guess. Rationale — a missing summary
costs field quality; a wrong summary creates the wrong person in the ATS. See
`104_ROOT_CAUSE.md`.

## Development

No real candidate HTML or PII was used to build or test this. All fixtures are
synthetic (`ANON-A`..`ANON-D`, `example.invalid`, non-allocated phone patterns).
The user's screenshot containing real PII was not transcribed into any file.

## Artifacts

`dist/talent-nexus-104-poc.pem` is the CRX signing key — keep it private, do
not commit it to a shared repo. The source zip excludes `original/` and
`dist/`.
