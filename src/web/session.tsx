import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { ensureCsrf, jsonRequest } from "./api"
import type { CurrentUser } from "./chat-types"

type Session = {
  /** `undefined` while the first lookup is in flight. */
  user: CurrentUser | null | undefined
  error: string
  signedIn: (user: CurrentUser) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null | undefined>()
  const [error, setError] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        await ensureCsrf()
        const result = await jsonRequest<{ user: CurrentUser | null }>(
          "/api/auth/session"
        )
        setUser(result.user)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not start OpenChat."
        )
        setUser(null)
      }
    })()
  }, [])

  const value = useMemo<Session>(
    () => ({
      user,
      error,
      signedIn: setUser,
      signOut: async () => {
        await jsonRequest("/api/auth/logout", { method: "POST" })
        setUser(null)
      },
    }),
    [user, error]
  )

  return <SessionContext value={value}>{children}</SessionContext>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error("useSession needs a SessionProvider")
  return session
}

/** For pages rendered inside the signed-in shell, where a user always exists. */
export function useCurrentUser(): CurrentUser {
  const { user } = useSession()
  if (!user) throw new Error("useCurrentUser used while signed out")
  return user
}
