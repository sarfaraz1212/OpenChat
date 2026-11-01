import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { isDisposableEmail } from "../../lib/auth/disposableEmail"
import { canonicalizeEmail, normalizeEmail } from "../../lib/auth/emailIdentity"
import * as users from "../../lib/db/users"
import {
  appUrl,
  emailConfigured,
  sendTransactional,
} from "../../lib/email/customerio"
import { EMAIL_UPDATED_MESSAGE_ID } from "../../lib/email/templates"
import { authed, router } from "../init"

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const accountRouter = router({
  get: authed.query(({ ctx }) => ({
    email: ctx.user.email,
    emailUpdates: ctx.user.opted_in_for_email_updates,
  })),

  /**
   * Change the account email. As in the legacy app there is no confirmation
   * step: it applies at once, so the disposable-address check still runs.
   */
  changeEmail: authed
    .input(z.object({ newEmail: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const newEmail = normalizeEmail(input.newEmail)
      if (!EMAIL_SHAPE.test(newEmail)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A valid email is required",
        })
      }
      if (newEmail === ctx.user.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New email must be different from your current email",
        })
      }
      if (isDisposableEmail(newEmail)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Please use a permanent email address. Temporary or disposable email addresses are not supported.",
        })
      }
      if (await users.findByEmail(ctx.db, newEmail)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists.",
        })
      }

      await users.setEmail(
        ctx.db,
        ctx.user.id,
        newEmail,
        canonicalizeEmail(newEmail)
      )
      // Tell the new address. The change has happened, so a failed notice does not undo it.
      if (emailConfigured(ctx.env)) {
        try {
          await sendTransactional(ctx.env, {
            messageId: EMAIL_UPDATED_MESSAGE_ID,
            to: newEmail,
            data: { loginUrl: appUrl(ctx.env), email: newEmail },
          })
        } catch (error) {
          console.error("[account] email-changed notice failed", error)
        }
      }
      return {
        email: newEmail,
        emailUpdates: ctx.user.opted_in_for_email_updates,
      }
    }),

  /** Turn the onboarding and re-engagement emails on or off. */
  setEmailUpdates: authed
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await users.setEmailUpdates(ctx.db, ctx.user.id, input.enabled)
      return { emailUpdates: input.enabled }
    }),
})
