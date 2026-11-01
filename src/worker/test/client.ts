import { createExecutionContext } from "cloudflare:test"
import { env, exports } from "cloudflare:workers"
import type { AppBindings } from "../env"
import worker from "../index"

const DEFAULT_ORIGIN = "https://openchat.test"

export type ClientOptions = {
  /** Where requests appear to come from, e.g. "http://localhost:5173". */
  origin?: string
  /** Bindings to override for this client, e.g. `{ CSRF_SECRET: "" }`. */
  env?: Partial<AppBindings>
}

type RequestOptions = {
  json?: unknown
  /** An already-serialised body, for sending deliberately malformed input. */
  raw?: string
  /** A multipart body, as the SPA's file upload sends it. */
  form?: FormData
  /**
   * A streamed body with no Content-Length, as a chunked upload arrives. The
   * byte cap has to hold without the header to lean on.
   */
  stream?: ReadableStream<Uint8Array>
  headers?: Record<string, string>
  /** Send the CSRF header the way the SPA does: echo the csrf_token cookie. */
  csrf?: boolean
}

/**
 * A browser stand-in: keeps a cookie jar across requests and talks to the
 * Worker only through its fetch interface, which is the test seam.
 */
export class TestClient {
  private cookies = new Map<string, string>()

  constructor(private readonly options: ClientOptions = {}) {}

  cookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  async request(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<Response> {
    const headers = new Headers(options.headers)
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
      )
    }
    if (options.csrf) {
      const token = this.cookies.get("csrf_token")
      if (token !== undefined) headers.set("x-csrf-token", token)
    }
    let body: string | FormData | ReadableStream<Uint8Array> | undefined =
      options.raw ?? options.form ?? options.stream
    if (options.json !== undefined) {
      headers.set("content-type", "application/json")
      body = JSON.stringify(options.json)
    }

    const request = new Request(
      `${this.options.origin ?? DEFAULT_ORIGIN}${path}`,
      // `duplex` is required for a streamed body and is not in the DOM types.
      {
        method,
        headers,
        body,
        ...(options.stream ? { duplex: "half" } : {}),
      } as RequestInit
    )
    const res = this.options.env
      ? await worker.fetch(
          request,
          { ...env, ...this.options.env },
          createExecutionContext()
        )
      : await exports.default.fetch(request)
    this.absorbCookies(res)
    return res
  }

  get(path: string, options?: RequestOptions) {
    return this.request("GET", path, options)
  }

  post(path: string, options?: RequestOptions) {
    return this.request("POST", path, options)
  }

  /** Obtain a CSRF cookie, as the SPA does once on boot. */
  async bootCsrf(): Promise<void> {
    await this.get("/api/csrf")
  }

  private absorbCookies(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";").map((part) => part.trim())
      const eq = pair.indexOf("=")
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      const expired = attributes.some((attr) => {
        const [k, v] = attr.split("=")
        if (k.toLowerCase() === "max-age") return Number(v) <= 0
        if (k.toLowerCase() === "expires") return Date.parse(v) <= Date.now()
        return false
      })
      if (expired || value === "") this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
}
