import type { AppBindings } from "../../env"

/** Email is sent only when both the API key and the app's public URL are set. */
export const emailConfigured = (env: AppBindings): boolean =>
  Boolean(env.CUSTOMERIO_API_KEY && env.APP_URL)

/** The app's public URL for links, without a trailing slash. */
export const appUrl = (env: AppBindings): string =>
  (env.APP_URL ?? "").replace(/\/+$/, "")

/**
 * Send one Customer.io transactional message (their send API, called directly
 * rather than through their Node SDK). Throws when it is not accepted.
 */
export async function sendTransactional(
  env: AppBindings,
  message: { messageId: string; to: string; data: Record<string, string> }
): Promise<void> {
  const response = await (env.OUTBOUND_FETCH ?? fetch)(
    "https://api.customer.io/v1/send/email",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CUSTOMERIO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transactional_message_id: message.messageId,
        to: message.to,
        identifiers: { email: message.to },
        message_data: message.data,
      }),
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (!response.ok) {
    throw new Error(`Customer.io send failed (${response.status})`)
  }
}
