import type { AppBindings } from "../../env"

/**
 * Password-reset email, sent through the Worker's `EMAIL` binding (Cloudflare
 * Email Service) rather than Customer.io: its wording lives here, so it needs
 * no template to be created anywhere first.
 */

const SENDER_NAME = "OpenChat"

/** Sent only when there is an address to send from and a public URL to link to. */
export const resetEmailConfigured = (env: AppBindings): boolean =>
  Boolean(env.EMAIL_FROM && env.APP_URL)

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

/**
 * Sends the link that lets `to` choose a new password. Throws when the email
 * service refuses (an error carrying a `code`, e.g. E_SENDER_DOMAIN_NOT_AVAILABLE).
 */
export async function sendPasswordResetEmail(
  env: AppBindings,
  message: { to: string; resetUrl: string }
): Promise<void> {
  const text = [
    "Someone asked to reset the password for your OpenChat account.",
    "",
    "Choose a new password here (the link works for one hour):",
    message.resetUrl,
    "",
    "If this wasn't you, ignore this email and your password stays as it is.",
  ].join("\n")

  const href = escapeHtml(message.resetUrl)
  const html =
    `<p>Someone asked to reset the password for your OpenChat account.</p>` +
    `<p><a href="${href}">Choose a new password</a> (the link works for one hour).</p>` +
    `<p>Or paste this address into your browser:<br>${href}</p>` +
    `<p>If this wasn't you, ignore this email and your password stays as it is.</p>`

  await env.EMAIL.send({
    to: message.to,
    from: { email: env.EMAIL_FROM!, name: SENDER_NAME },
    subject: "Reset your OpenChat password",
    text,
    html,
  })
}
