# Attribution and third-party notices

## LobeHub

OpenChat's feature set, data model and much of its product design are a
reimplementation of [`lobehub/lobehub`](https://github.com/lobehub/lobehub),
which is distributed under the **LobeHub Community License** (Apache-2.0 with
an additional commercial clause). Agents and agent groups, the knowledge base,
the five-layer user memory, the goal and task graph, the cloud sandbox tool
interface and the usage dashboard all follow that project's design.

No upstream source file is included here. The implementation is written against
Cloudflare Workers, Hono and D1, and the upstream name, logo and copy do not
appear anywhere a user of this app can see them. Source comments that mention
LobeHub are provenance notes for maintainers, kept deliberately so the lineage
of each subsystem stays traceable.

The licensing position, including why this project proceeds as a derivative
work and the circumstances that would require revisiting it, is recorded in
[`docs/plans/lobehub-migration/decisions/0001-license-and-legal-risk.md`](docs/plans/lobehub-migration/decisions/0001-license-and-legal-risk.md).
**If OpenChat is ever offered to other organizations, white-labeled or resold,
that decision must be revisited** — the upstream license directs you to contact
LobeHub (hello@lobehub.com) in that case.

> The `LICENSE` file in this repository is the plain Apache License 2.0 carried
> over from this app's own pre-migration history. It describes OpenChat's own
> code and does not capture the LobeHub Community License obligations described
> above. Settling what this repository should ultimately be licensed under is a
> decision for its owner, not something this migration changed on its behalf.

## Models and services

All chat, embedding and image models run on **Cloudflare Workers AI**. Model
names such as "GPT-OSS", "DeepSeek", "Llama", "Gemma", "Mistral", "Qwen",
"FLUX" and "Lucid Origin" identify the open-weight models their authors
published and that Cloudflare hosts; they are not calls to those vendors' own
hosted APIs, and their trademarks belong to their respective owners.

Optional third-party services, each used only when its key is configured:
Black Forest Labs (image editing), Tavily, Perplexity or Serper (web search for
Deep Research) and Customer.io (transactional email).

## Bundled data

The disposable-email blocklist in `src/worker/lib/auth/disposableDomains.generated.ts`
is generated from
[`disposable-email-domains/disposable-email-domains`](https://github.com/disposable-email-domains/disposable-email-domains)
(CC0-1.0) by `scripts/sync-disposable-domains.mjs`.
