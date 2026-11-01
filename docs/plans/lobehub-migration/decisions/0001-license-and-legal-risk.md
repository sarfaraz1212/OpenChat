# 0001 — License handling for a full LobeHub replica

## Context

The reference repo (`lobehub/lobehub`) is licensed under the **LobeHub Community License** (Apache-2.0 based, not plain Apache-2.0). It permits commercial use "as a frontend and backend service without modifying the source code," but requires a separate commercial license from LobeHub LLC if you "develop and distribute a derivative work." A full-platform replica under different branding, with a different backend (D1/Cloudflare instead of Postgres/generic hosting), is a textbook derivative work under that clause. This is compounded by the scope decision (0002): the target isn't the smaller classic "LobeChat" but the full `lobehub/lobehub` commercial platform, which has its own private `lobehub-cloud` overlay repo and explicit "commercial license" feature flags in its own codebase.

## Decision

Proceed with the copy. The user's explicit rationale: **this will not be sold** — it's being built and deployed as OpenChat, not distributed or resold as a commercial product to third parties.

## Consequences

- This does not eliminate legal risk — "not selling it" is not the same as "not distributing a derivative work," which is the actual trigger in the license text. The user made this call explicitly and knowingly; it is not this plan's place to re-litigate it.
- If the deployment model ever changes — e.g. OpenChat starts being offered to other organizations, white-labeled, or resold — this decision must be revisited and likely requires contacting LobeHub (hello@lobehub.com) as the license itself instructs.
- Keep this file as the record of that decision and its stated rationale, in case it needs revisiting later.
