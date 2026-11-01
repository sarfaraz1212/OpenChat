import { useEffect, useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { ensureCsrf, jsonRequest } from "../api"

/** Where the emailed link lands: choose a new password, then sign in with it. */
export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // The link carries the token in its query string. Keep it in memory only and
  // take it out of the address bar and history once it has been read.
  const [token] = useState(() => params.get("token") ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  useEffect(() => {
    void navigate("/reset-password", { replace: true })
  }, [navigate])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get("password") ?? "")
    if (password !== data.get("confirm")) {
      setError("The two passwords do not match.")
      return
    }
    setBusy(true)
    setError("")
    try {
      await ensureCsrf()
      await jsonRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      })
      setDone(true)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not reset your password."
      )
    } finally {
      setBusy(false)
    }
  }

  // A full load, not a client-side navigation: resetting ended every session,
  // including one this browser may still believe it has.
  const toSignIn = () => window.location.assign("/")

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
        <h1>{done ? "Password updated" : "Choose a new password"}</h1>
        {done ? (
          <>
            <p className="auth-copy">
              You have been signed out everywhere. Sign in with your new
              password.
            </p>
            <button className="primary-button" type="button" onClick={toSignIn}>
              Go to sign in
            </button>
          </>
        ) : !token ? (
          <>
            <p className="auth-copy">
              This reset link is incomplete. Open the link from your email
              again, or request a new one from the sign-in page.
            </p>
            <button className="primary-button" type="button" onClick={toSignIn}>
              Go to sign in
            </button>
          </>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={3}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={3}
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Please wait…" : "Update password"}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
