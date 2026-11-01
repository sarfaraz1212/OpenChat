import { Link } from "react-router"

export function NotFound() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Page not found</h1>
      <Link to="/">Back to OpenChat</Link>
    </main>
  )
}
