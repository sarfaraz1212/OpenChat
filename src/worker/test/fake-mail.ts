/* Customer.io (transactional email) for tests. */

export type MailCall = {
  /** The Authorization header the API key was sent in. */
  auth: string | null
  body: {
    transactional_message_id: string
    to: string
    identifiers: { email: string }
    message_data: Record<string, string>
  }
}

/** A fake for the outbound HTTP boundary that plays the Customer.io send API. */
export function fakeCustomerIo(
  handler?: (call: MailCall) => Response | undefined
) {
  const calls: MailCall[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url !== "https://api.customer.io/v1/send/email") {
      return new Response("unexpected request", { status: 500 })
    }
    const call: MailCall = {
      auth: request.headers.get("authorization"),
      body: await request.json(),
    }
    calls.push(call)
    return handler?.(call) ?? Response.json({ delivery_id: "delivery" })
  }
  return {
    fetch: fetcher,
    calls,
    /** The transactional message ids sent so far, in order. */
    ids: () => calls.map((call) => call.body.transactional_message_id),
  }
}

/**
 * The `EMAIL` binding (Cloudflare Email Service) for tests: it records what the
 * Worker asked it to send. `reject` makes a send fail the way the service does,
 * with an error carrying a `code`.
 */
export function fakeEmailBinding(options: { reject?: string } = {}) {
  const messages: EmailMessageBuilder[] = []
  const binding: SendEmail = {
    send: async (message: EmailMessage | EmailMessageBuilder) => {
      if (options.reject) {
        throw Object.assign(new Error("send rejected"), {
          code: options.reject,
        })
      }
      messages.push(message as EmailMessageBuilder)
      return { messageId: `message-${messages.length}` }
    },
  }
  return { binding, messages }
}
