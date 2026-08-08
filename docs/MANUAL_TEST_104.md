# Manual Test Plan — 104 (office machine, authenticated)

## Install
1. `chrome://extensions` -> Developer mode ON.
2. Remove/disable the currently installed PINPINSOFT to avoid two copies racing.
3. **Load unpacked** -> `dist/unpacked`.
4. Confirm it shows `5000.0.108 Golden Base + 104 POC`.
5. Log into Pinpin so session cookies exist.

## Golden path first
Run `LINKEDIN_REGRESSION.md` L1-L10 **before** testing 104. If any fails, stop
and revert to the original CRX — do not proceed.

## 104 tests
| # | Step | Expected | Record |
|---|---|---|---|
| T1 | Open `vip.104.com.tw` homepage, F12 console | **no** `[TN104]` logs | |
| T2 | Open a 104 job-management page | no `[TN104]` logs | |
| T3 | Open a candidate resume under `/search/SearchResumeMaster`, wait 2 s | `[TN104] capture mode=... chars=... ok=true` then `duplicate -> checkRepeat` | note `mode` |
| T4 | Same page | kpBox appears with duplicate result or "no duplicate" | |
| T5 | Toolbox precise check | `click=click`, `htmlfileauto3` in Network | |
| T6 | Toolbox precise check 2 | `click=click2`, `htmlfileauto4` | |
| T7 | Toolbar click -> import | `import -> request.api.addResume.normal`, Pinpin candidate edit page opens | |
| T8 | In Pinpin, check parsed fields | name / company / title / dates / education / skills present and correct | **key quality gate** |
| T9 | Candidate with **visible** contact | phone + email parsed | |
| T10 | Candidate with **masked** contact | no error; import still completes; contact blank | |
| T11 | Duplicate found -> update/replace | `bind_candidatecrxnew` succeeds, candidate updated | |
| T12 | Candidate page with an internal recruiter remark | remark text does **not** appear as the candidate's name/phone in Pinpin | **key safety gate** |
| T13 | Navigate to a second candidate **without reloading** | expected to NOT auto-fire (known 2 s-timer limitation) — use precise check | confirm workaround works |
| T14 | Reload on the second candidate | auto check fires | |
| T15 | Console review of the whole session | no resume HTML, no PII, no cookies logged | |

## If T8 parse quality is poor
Record which `mode` was used and which fields were wrong. Do not widen the
capture blindly — the likely fix is a more specific resume container, not more
HTML.

## Compliance reminder
Only view resumes your 104 account may already view. Do not click anything that
consumes credits as part of testing beyond your normal workflow. The extension
never unlocks anything on its own.
