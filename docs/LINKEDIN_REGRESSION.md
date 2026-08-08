# LinkedIn Regression

## Statement

**LinkedIn implementation unchanged.**

No LinkedIn selector, timing, expansion behaviour, DOM capture, message type or
Pinpin call was modified. Specifically untouched:
- the `-1<F.indexOf("linkedin")` branch in `catchHtmlToCheckRepeat`
- the delegated `body` click bindings on LinkedIn result cards
- `linkedin.checkRepeat` / `linkedin.checkRepeatReceived` and the 2500 ms delay
  in `js/versions/v1/background/index.js`
- the `linkedin.checkRepeatReceived` container-selection handler
- the `-1<t.indexOf("linkedin")` import branch in `ce.browserAction`
- `background.js`, `data.js`, `request.js` — **zero changes**
- Pinpin authentication (`loginparam`, `/rest/user/loginsimulation`) — **zero changes**

The only shared-file edits are three additive one-liners in
`js/versions/v1/default/page.js` (see `104_PATCH.md`). Each new branch is gated
on `location.hostname === "vip.104.com.tw"`, which is false on LinkedIn, so on a
LinkedIn page control falls through to the incumbent branch byte-identically.

Verify with: `git diff baseline -- js/versions/v1/default/page.js` inside `working/`.

## Manual regression tests still required (office machine, authenticated)

| # | Test | Expected | Status |
|---|---|---|---|
| L1 | Open a LinkedIn profile, wait 2 s | auto duplicate check fires, kpBox shows result | NOT TESTED |
| L2 | Click a search-result card in LinkedIn search | duplicate check fires after ~1.2 s + 2.5 s | NOT TESTED |
| L3 | Toolbox precise check on a LinkedIn profile | `htmlfileauto3` called, result rendered | NOT TESTED |
| L4 | Toolbox precise check 2 | `htmlfileauto4` called | NOT TESTED |
| L5 | Toolbar click -> import on a LinkedIn profile | contact-info expansion runs, `htmlfile` posted, edit page opens | NOT TESTED |
| L6 | Existing candidate -> update/replace | `bind_candidatecrxnew` / `bind_candidatecrx` succeeds | NOT TESTED |
| L7 | Import while logged out of Pinpin | `loginparam` -> `loginsimulation` retry still works | NOT TESTED |
| L8 | LinkedIn Recruiter (not just public profile) | same as L1/L5 | NOT TESTED |
| L9 | Sanity: zhipin / liepin / 51job page | unchanged behaviour | NOT TESTED |
| L10 | DevTools console on LinkedIn | no `[TN104]` output at all | NOT TESTED |

L10 is the cheapest proof the 104 branch is inert on the golden path.
