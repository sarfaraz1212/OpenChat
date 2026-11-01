/**
 * The 18 drip emails. Each is a Customer.io transactional message, referred to
 * by id; its wording lives in Customer.io, and only the links it needs are
 * supplied here. The ids and variables are the legacy app's.
 */

export type EmailContext = {
  /** The app's public URL, without a trailing slash. */
  appUrl: string
  /** The user's latest conversation, or the app URL when they have none. */
  conversationUrl: string
}

export type EmailTemplate = {
  messageId: string
  variables: (context: EmailContext) => Record<string, string>
}

const login = ({ appUrl }: EmailContext) => ({ loginUrl: appUrl })
const nothing = () => ({})

/** Days 1 to 6. The array index is the template id stored on the job. */
export const ONBOARDING: readonly EmailTemplate[] = [
  { messageId: "24", variables: login },
  { messageId: "25", variables: login },
  { messageId: "26", variables: login },
  {
    messageId: "27",
    variables: ({ appUrl }) => ({ deepSearchUrl: `${appUrl}/deep-research` }),
  },
  {
    messageId: "28",
    variables: ({ appUrl }) => ({ generateImageUrl: `${appUrl}/images` }),
  },
  { messageId: "29", variables: login },
]

/** Sent to a quiet user once they have been away this many hours. */
export const RELANCE: ReadonlyArray<EmailTemplate & { hours: number }> = [
  {
    hours: 1,
    messageId: "30",
    variables: ({ appUrl, conversationUrl }) => ({
      loginUrl: appUrl,
      conversationUrl,
    }),
  },
  { hours: 5, messageId: "35", variables: nothing },
  {
    hours: 24,
    messageId: "34",
    variables: ({ conversationUrl }) => ({ conversationUrl }),
  },
  { hours: 48, messageId: "36", variables: login },
  { hours: 60, messageId: "38", variables: login },
  { hours: 72, messageId: "32", variables: login },
  { hours: 96, messageId: "31", variables: login },
  { hours: 120, messageId: "33", variables: login },
  { hours: 144, messageId: "37", variables: nothing },
  { hours: 168, messageId: "43", variables: nothing },
  { hours: 192, messageId: "44", variables: nothing },
  { hours: 216, messageId: "45", variables: nothing },
]

/** Tells the address an account was moved to that it is now the account's email. */
export const EMAIL_UPDATED_MESSAGE_ID = "39"

/** The template id of the furthest step a user has reached after `hours` away, or null. */
export function relanceStepForHours(hours: number): number | null {
  for (let step = RELANCE.length - 1; step >= 0; step--) {
    if (hours >= RELANCE[step].hours) return step
  }
  return null
}
