import { useCallback, useEffect, useState, type FormEvent } from "react"
import { api } from "../api"
import type { Account } from "../chat-types"
import { useShell } from "../components/AppShell"
import { Icon } from "../components/Icon"

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback

/** The account's email address and whether product emails may be sent to it. */
export function AccountSettings() {
  const shell = useShell()
  const [account, setAccount] = useState<Account | null>(null)
  const [newEmail, setNewEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  const reload = useCallback(async () => {
    setAccount(await api.account.get.query())
  }, [])

  useEffect(() => {
    void reload().catch(() => setError("Could not load your account."))
  }, [reload])

  async function changeEmail(event: FormEvent) {
    event.preventDefault()
    if (!newEmail.trim() || busy) return
    setBusy(true)
    setError("")
    setNote("")
    try {
      setAccount(await api.account.changeEmail.mutate({ newEmail }))
      setNewEmail("")
      setNote("Your email has been changed. Sign in with the new address.")
    } catch (cause) {
      setError(message(cause, "Could not change your email."))
    } finally {
      setBusy(false)
    }
  }

  async function setEmailUpdates(enabled: boolean) {
    setAccount((current) =>
      current ? { ...current, emailUpdates: enabled } : current
    )
    try {
      await api.account.setEmailUpdates.mutate({ enabled })
    } catch (cause) {
      setError(message(cause, "Could not save that."))
      await reload().catch(() => undefined)
    }
  }

  return (
    <section className="conversation settings-page">
      <header className="chat-header">
        <button
          className="menu-button"
          type="button"
          onClick={shell.openSidebar}
          aria-label="Open menu"
        >
          <Icon name="menu" size={18} />
        </button>
        <div>
          <strong>Account</strong>
          <span className="model-identity">
            Your email address and what we send to it
          </span>
        </div>
      </header>
      <div className="settings-body">
        {error && <p className="chat-error">{error}</p>}
        {note && <p className="panel-note">{note}</p>}
        {!account && !error && <p className="panel-note">Loading…</p>}

        {account && (
          <>
            <form
              className="form-card"
              onSubmit={(event) => void changeEmail(event)}
            >
              <h2 className="card-title">Email address</h2>
              <p className="panel-note flush">
                You sign in with <strong>{account.email}</strong>. Changing it
                takes effect at once, and we tell the new address.
              </p>
              <label className="field">
                New email
                <input
                  type="email"
                  value={newEmail}
                  placeholder="you@example.com"
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </label>
              <div className="form-actions">
                <button
                  className="primary-button"
                  disabled={busy || !newEmail.trim()}
                >
                  {busy ? "Changing…" : "Change email"}
                </button>
              </div>
            </form>

            <div className="provider-card">
              <div className="provider-card-head">
                <div>
                  <h1>Product emails</h1>
                  <p>
                    A short series about what OpenChat can do, and the
                    occasional nudge if you have been away. Turning this off
                    stops both; account notices, such as an email change, are
                    still sent.
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label="Send me product emails"
                    checked={account.emailUpdates}
                    onChange={(event) =>
                      void setEmailUpdates(event.target.checked)
                    }
                  />
                  <span />
                </label>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
