import { cloudflare } from "@cloudflare/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

/**
 * Vite's dev server delivers CSS by injecting <style> elements from JS, which
 * `style-src 'self'` blocks: the app renders unstyled under `pnpm dev`. This
 * relaxes that one directive for the dev server only. The built `index.html`
 * keeps the strict policy, and `vite preview` serves the built file, so what
 * production enforces is never weakened.
 */
const devCsp: Plugin = {
  name: "openchat-dev-csp",
  apply: "serve",
  transformIndexHtml(html) {
    return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  },
}

export default defineConfig({
  plugins: [react(), cloudflare(), devCsp],
  // Vite scans every *.html under the project root for dependencies to
  // pre-bundle and watches every file for changes. new/lobehub is a 1.2 GB
  // read-only reference clone with its own index.html files, so both must be
  // pointed at this app only.
  optimizeDeps: { entries: ["index.html"] },
  server: {
    watch: { ignored: ["**/new/**", "**/.wrangler/**", "**/dist/**"] },
  },
})
