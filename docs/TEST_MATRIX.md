# Test matrix

Status: STATIC VERIFIED | IMPLEMENTED | READY FOR MANUAL TEST | LIVE TESTED | FAILED

No real PII. Candidates referred to as A/B/C/D.

## Automated (STATIC VERIFIED)

| Spec | Assertions | Covers |
|---|---|---|
| `site104.spec.js` | 74 | detection, capture ladder, noise strip, remark isolation, integration |
| `site104.identity.spec.js` | 36 | **wrong-candidate contamination**, 4 selection strategies, ambiguity, stale state |
| `tntrace.spec.js` | 54 | tracer semantics, AST privacy scan |
| `tntrace.diff.spec.js` | 139 | A/B behaviour neutrality (messaging + fetch) |
| **Total** | **303** | |

## Manual live tests (ALL: READY FOR MANUAL TEST)

| # | Scenario | Detect | cardPick | Capture | Dup | htmlfile | temp | Identity = opened? | Work hist | Edu | Status | Save | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | LinkedIn candidate D (**golden control — run first**) | | n/a | | | | | | | | | | |
| T2 | 104 candidate A, visible contact | | | | | | | | | | | | |
| T3 | 104 candidate B, masked contact | | | | | | | | | | | | |
| T4 | 104 candidate C **immediately after A** (stale state) | | | | | | | | | | | | |
| T5 | 104 search list, several cards, A opened | | | | | | | | | | | | |
| T6 | 104 non-resume page (must NOT activate) | | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | |
| T7 | 104 candidate with recruiter remark (must not become identity) | | | | | | | | | | | | |

**T5 is the regression test for the live bug.** New Talent must show the
candidate you opened, never another card in the list.

**T1 must pass before any 104 test.** If LinkedIn regressed, stop and revert.

## Record for each row

- `cardPick=` value from `[TN104] capture`
- `mode=` and `chars=`
- whether New Talent identity matches the opened candidate
- Status dropdown option count
- Save outcome and which candidate Pinpin opened
