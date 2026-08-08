# 104 Root Cause — wrong candidate identity

**Status: REPRODUCED STATICALLY, FIXED, NOT YET LIVE TESTED.**

## Symptom

Candidate A open on 104. Import. New Talent populated with candidate B's name
and an unrelated 11-digit mobile. Save created candidate B.

## Root cause

`capture104Resume()` selected the summary card with `querySelector`:

```js
var card = q(CARD_SELECTOR);   // .vip-resume-card.resume-card
```

On `SearchResumeMaster` / `hunter/master` the left pane is a **list** of
candidate cards. `querySelector` returns the **first** one, which is not the
opened candidate. The payload was therefore:

```
<section data-source="104-summary">  candidate B   <- first card in the list
<section data-source="104-resume">   candidate A   <- opened resume
```

Pinpin's parser takes identity from the leading summary block, so it returned
candidate B. Everything downstream was working correctly on bad input.

Answers to the traced questions:

| Question | Answer |
|---|---|
| Source of wrong identity | **A. captured DOM** — our capture, not Pinpin |
| Source of wrong mobile | first card's phone in the same wrong summary |
| Was `/temp` identity wrong? | **Yes — correctly wrong.** It faithfully parsed what we sent |
| Cache/stale state? | **No.** Each capture reads live DOM; proven by the stale-state test |
| Field mapping? | **No.** `AddResumeCtrl` maps `temp[0].extract.*` correctly |

This also invalidates my two earlier hypotheses (`addFileName`, then
`Config.api`). Both were guesses; this one is reproduced by a failing test.

## Fix

`findOpenCandidateCard(wrapper)` resolves the opened candidate, strictest first:

1. `data-id` / `data-resume-id` / `data-idno` matching the opened wrapper
2. `active` / `is-active` / `selected` / `is-selected` / `current` / `on`, or `aria-selected="true"`
3. `?id=` in the URL
4. **ambiguous -> omit the summary entirely**

Step 4 is the important one. If we cannot prove which card is open, we send the
resume body alone rather than risk importing the wrong person. Losing a summary
is recoverable; creating the wrong candidate is not.

Logged as `cardPick=` — `id-match`, `active-class`, `aria-selected`, `url-id`,
`only-card`, `ambiguous-omitted`.

## Evidence

`test/site104.identity.spec.js`, 36 assertions.

Before the fix: `A=true B=true Bphone=true`, B at offset 209 before A at 457.
After: `A=true B=false Bphone=false`, A first.

Mutation-tested: reverting to `q(CARD_SELECTOR)` fails 13 assertions, so the
test genuinely detects the bug rather than passing vacuously.

## Not yet verified live

Whether real 104 markup exposes `data-id` or an active class. If neither, real
pages will log `cardPick=ambiguous-omitted` and import the resume body without
a summary — safe, but reduced field quality. **Check `cardPick=` on the first
live run.** If it says `ambiguous-omitted`, send me the card element's
attribute names (no values) and I will add the real selector.
