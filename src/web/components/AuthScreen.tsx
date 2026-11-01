import { useState, type FormEvent } from "react"
import { jsonRequest } from "../api"
import type { CurrentUser } from "../chat-types"

type Mode = "login" | "register" | "forgot"

const TITLES: Record<Mode, string> = {
  login: "Welcome back",
  register: "Create your account",
  forgot: "Reset your password",
}

export function AuthScreen({
  onSignedIn,
}: {
  onSignedIn: (user: CurrentUser) => void
}) {
  const [mode, setMode] = useState<Mode>("login")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  /** A reset link was requested. The answer is the same for unknown addresses. */
  const [linkSent, setLinkSent] = useState(false)

  function switchTo(next: Mode) {
    setError("")
    setLinkSent(false)
    setMode(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError("")
    const data = new FormData(event.currentTarget)
    try {
      if (mode === "forgot") {
        await jsonRequest("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: data.get("email") }),
        })
        setLinkSent(true)
        return
      }
      const result = await jsonRequest<{ user: CurrentUser }>(
        `/api/auth/${mode}`,
        {
          method: "POST",
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
            ...(mode === "register"
              ? { displayName: data.get("displayName") }
              : {}),
          }),
        }
      )
      onSignedIn(result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <picture>
          <source
            srcSet="/logo-openchat-mark-dark.svg"
            media="(prefers-color-scheme: dark)"
          />
          <img src="/logo-openchat-mark.svg" alt="" className="auth-logo" />
        </picture>
        <div className="eyebrow">OPENCHAT</div>
        <h1>{TITLES[mode]}</h1>
        <p className="auth-copy">
          {mode !== "forgot"
            ? "Your focused workspace for conversations with open-weight AI."
            : linkSent
              ? "If an account exists for that address, a link to reset your password is on its way. It works for one hour."
              : "Enter your email and we will send you a link to choose a new password."}
        </p>
        {!(mode === "forgot" && linkSent) && (
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                Name <span>optional</span>
                <input name="displayName" autoComplete="name" />
              </label>
            )}
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            {mode !== "forgot" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={mode === "register" ? 3 : undefined}
                  required
                />
              </label>
            )}
            {mode === "login" && (
              <button
                className="text-button"
                type="button"
                onClick={() => switchTo("forgot")}
              >
                Forgot your password?
              </button>
            )}
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Sign up"
                    : "Send reset link"}
            </button>
          </form>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() => switchTo(mode === "login" ? "register" : "login")}
        >
          {mode === "login"
            ? "New to OpenChat? Create an account"
            : mode === "register"
              ? "Already have an account? Sign in"
              : "Back to sign in"}
        </button>
      </section>
    </main>
  )
}
