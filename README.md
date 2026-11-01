# OpenChat

Self-hosted AI workspace for Cloudflare Workers AI: chat, agents, memory, knowledge, images, and research on your own account.

<p align="center">
  <img src="docs/readme/screenshots/home.png" alt="OpenChat home, with the composer, Llama 3.3 70B, and starting ideas" width="100%">
</p>

<p align="center">
  Interface based on <a href="https://github.com/lobehub/lobe-chat">LobeChat</a>
  ·
  <a href="mailto:singhsarfaraz5507@gmail.com">singhsarfaraz5507@gmail.com</a>
</p>

<p align="center">
  <img src="docs/readme/logos/meta.svg" width="26" alt="Meta">
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/openai-dark.svg">
    <img src="docs/readme/logos/openai.svg" width="26" alt="OpenAI">
  </picture>
  &nbsp;
  <img src="docs/readme/logos/mistral.svg" width="26" alt="Mistral">
  &nbsp;
  <img src="docs/readme/logos/deepseek.svg" width="26" alt="DeepSeek">
  &nbsp;
  <img src="docs/readme/logos/qwen.svg" width="26" alt="Qwen">
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/zai-dark.svg">
    <img src="docs/readme/logos/zai.svg" width="26" alt="Z.ai">
  </picture>
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/kimi-dark.svg">
    <img src="docs/readme/logos/kimi.svg" width="26" alt="Kimi">
  </picture>
  &nbsp;
  <img src="docs/readme/logos/gemma.svg" width="26" alt="Gemma">
  &nbsp;
  <img src="docs/readme/logos/nvidia.svg" width="26" alt="NVIDIA">
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/flux-dark.svg">
    <img src="docs/readme/logos/flux.svg" width="26" alt="FLUX, Black Forest Labs">
  </picture>
</p>

The name in the shot is a local test user.

<a id="models"></a>

## Workers AI models

Open-weight models hosted by Cloudflare Workers AI. OpenChat does not call OpenAI, Google, Meta, or anyone else's API. The default is Llama 3.3 70B. The list lives in `src/shared/models.ts`.

### Chat

| | Model | Best for |
| --- | --- | --- |
| <img src="docs/readme/logos/meta.svg" width="22" alt=""> | Llama 3.3 70B | Everyday chat, analysis, and writing. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/openai-dark.svg"><img src="docs/readme/logos/openai.svg" width="22" alt=""></picture> | GPT-OSS 120B | Reasoning and long drafts. 128k context. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/openai-dark.svg"><img src="docs/readme/logos/openai.svg" width="22" alt=""></picture> | GPT-OSS 20B | Faster general chat. 128k context. |
| <img src="docs/readme/logos/meta.svg" width="22" alt=""> | Llama 4 Scout | General assistant work. |
| <img src="docs/readme/logos/mistral.svg" width="22" alt=""> | Mistral Small 3.1 | Short answers and summaries. |
| <img src="docs/readme/logos/deepseek.svg" width="22" alt=""> | DeepSeek V4 Pro | Hard reasoning. 1M context. |
| <img src="docs/readme/logos/deepseek.svg" width="22" alt=""> | DeepSeek V4 Flash | Reasoning, quicker. 1M context. |
| <img src="docs/readme/logos/deepseek.svg" width="22" alt=""> | DeepSeek R1 Distill 32B | Step-by-step technical thinking. |
| <img src="docs/readme/logos/qwen.svg" width="22" alt=""> | Qwen2.5 Coder 32B | Code. |
| <img src="docs/readme/logos/qwen.svg" width="22" alt=""> | Qwen3 30B | Multilingual general chat. |
| <img src="docs/readme/logos/qwen.svg" width="22" alt=""> | Qwen3.8 27B | Coding, reasoning, and multilingual chat. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/zai-dark.svg"><img src="docs/readme/logos/zai.svg" width="22" alt=""></picture> | GLM 5.2 | General chat and analysis. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/zai-dark.svg"><img src="docs/readme/logos/zai.svg" width="22" alt=""></picture> | GLM 5.3 | Harder reasoning. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/zai-dark.svg"><img src="docs/readme/logos/zai.svg" width="22" alt=""></picture> | GLM 5.3 Flash | Fast GLM replies. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/kimi-dark.svg"><img src="docs/readme/logos/kimi.svg" width="22" alt=""></picture> | Kimi K2.6 | Longer research-style conversation. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/kimi-dark.svg"><img src="docs/readme/logos/kimi.svg" width="22" alt=""></picture> | Kimi K2.7 Code | Implementation and code edits. |
| <img src="docs/readme/logos/gemma.svg" width="22" alt=""> | Gemma 4 26B | Vision and multimodal prompts. 256k context. |
| <img src="docs/readme/logos/nvidia.svg" width="22" alt=""> | Nemotron 3 120B | Difficult reasoning. |
| <img src="docs/readme/logos/meta.svg" width="22" alt=""> | Llama 3.1 8B | Short, cheap replies. |

Speech uses Whisper Large V3 Turbo. Knowledge and memory use `bge-m3`.

### Image generation

| | Model | Best for |
| --- | --- | --- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/flux-dark.svg"><img src="docs/readme/logos/flux.svg" width="22" alt=""></picture> | FLUX.2 Dev | Highest detail. 32B, 50 steps. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/flux-dark.svg"><img src="docs/readme/logos/flux.svg" width="22" alt=""></picture> | FLUX.2 Klein 9B | Close to FLUX.2 quality, much faster. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/flux-dark.svg"><img src="docs/readme/logos/flux.svg" width="22" alt=""></picture> | FLUX.2 Klein 4B | Fastest FLUX.2. Weaker on realism. |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/readme/logos/flux-dark.svg"><img src="docs/readme/logos/flux.svg" width="22" alt=""></picture> | FLUX.1 Schnell | Quick drafts in 2 steps. Lowest detail. |
| | Lucid Origin | Photorealism and a wide style range. Leonardo AI. |
| | Phoenix 1.0 | Highest resolution and text in the image. Leonardo AI. |

<a id="start"></a>

## Run it locally

```bash
cp .dev.vars.example .dev.vars
```

Set `CSRF_SECRET` to 32 or more random characters, then:

```bash
docker compose up --build
```

Open http://localhost:5173. The local database stays in the `openchat-local` volume. Chat also needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.dev.vars`.

Without Docker:

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

`pnpm db:migrate:local` touches only the local database. [Deploy OpenChat on your own Cloudflare account](./DEPLOY.md). Docker does not deploy, and it does not start `sandbox/Dockerfile`.

| Variable | What stays off without it |
| --- | --- |
| `BFL_API_KEY` | Background removal and enhance |
| `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, or `SERPER_API_KEY` | Deep Research. The first key set is used, in that order |
| `EMAIL_FROM` | Password-reset mail, through Cloudflare Email Service. There is no SMTP server |
| `CUSTOMERIO_API_KEY` and `APP_URL` | Onboarding and re-engagement mail |
| `CRON_SECRET` | The email cron route |

Do not commit `.env` or `.dev.vars`. One Worker, a Vite React app, D1, R2, Vectorize, and Workflows.

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

---

Apache-2.0. Copyright 2026 [singhsarfaraz5507@gmail.com](mailto:singhsarfaraz5507@gmail.com).

The interface is based on [LobeChat](https://github.com/lobehub/lobe-chat) by [LobeHub](https://github.com/lobehub/lobehub). This repository does not include their source. See [ATTRIBUTION.md](./ATTRIBUTION.md) and [LICENSE](./LICENSE).
