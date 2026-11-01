import type { Sandbox } from "@cloudflare/sandbox"
import type { SandboxProvider } from "./lib/sandbox/backend"

export type AppBindings = Cloudflare.Env & {
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_AI_GATEWAY?: string
  /** Test-only override for the outbound Workers AI request boundary. */
  AI_FETCH?: typeof fetch
  /** Black Forest Labs key for background removal and the image enhancer. */
  BFL_API_KEY?: string
  /** Web search for Deep Research: the first of these that is set is used. */
  TAVILY_API_KEY?: string
  PERPLEXITY_API_KEY?: string
  SERPER_API_KEY?: string
  /** Customer.io app API key for transactional email; unset means no email is sent. */
  CUSTOMERIO_API_KEY?: string
  /** Public URL of the app, used in email links. Emails are not sent without it. */
  APP_URL?: string
  /**
   * The address password-reset emails are sent from, on a domain onboarded to
   * Cloudflare Email Service. Unset means reset links are not emailed.
   */
  EMAIL_FROM?: string
  /** Bearer secret for the cron endpoint; the endpoint is closed without it. */
  CRON_SECRET?: string
  /** Test-only override for outbound requests to third-party services. */
  OUTBOUND_FETCH?: typeof fetch
  /**
   * The Cloudflare Sandbox Durable Object namespace. Absent until the container
   * is configured (it needs a Docker image; see DEPLOY.md), in which case agents
   * simply get no code-execution tools.
   */
  SANDBOX?: DurableObjectNamespace<Sandbox>
  /** Test-only replacement for the sandbox backend. */
  SANDBOX_BACKEND?: SandboxProvider
}

export type AppEnv = {
  Bindings: AppBindings
}
