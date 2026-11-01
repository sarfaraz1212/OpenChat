# 0010 — Branch strategy

**Amended 2026-09-20.** The first version of this ADR said all migration work lands on `main` and `master` is a frozen snapshot. Both halves were wrong; see "What changed".

## Decision

- **`main`** stays the legacy app, and stays deployable. Cloudflare Workers Builds is connected to it and redeploys production on every push, so no migration work is pushed to `main` before the Phase 14 cutover.
- **`master`** was cut from `main` at commit `8e6c41c` ("Unmount the onboarding heading instead of animating it out") and pushed to `origin/master`. It is the trunk for the new build: migration branches (`migration/phase-N-*`) fast-forward or merge into it.
- Migration work happens on `migration/*` branches. Nothing is pushed to `main`, and nothing is pushed anywhere without the user asking.
- At the Phase 14 cutover, `master` replaces `main` deliberately: restore the real D1 `database_id`, rename the Worker to `openchat`, repoint Workers Builds (see `DEPLOY.md`).

## What changed

The user's first message said _"do code in master branch so main code has old project"_: new code on `master`, old project on `main`. The first draft of this ADR read it the other way round, on the theory that `master` would be a frozen snapshot, and the user's silence on that question was treated as agreement. It wasn't a confirmation, and the plan had also missed that `main` auto-deploys to production, which makes the original reading the safe one.

## Consequences

- Anyone comparing "does the ported feature match the old one" (Phase 12) diffs against `main` (latest legacy, including the peer session's continuing commits) or `master@8e6c41c` (the exact snapshot).
- `master` currently holds the pre-migration app plus, once merged, the migration work. Until the cutover, treat `origin/master` as _not deployed_, and confirm in the Workers Builds settings that non-production branch builds don't deploy it.
- A peer session (`nexcoach-fb`) keeps iterating on the legacy app on `main`. That is now safe and expected until cutover; port their changes forward when a phase touches the same area.
