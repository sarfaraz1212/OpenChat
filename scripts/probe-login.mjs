/**
 * Opens the probe's browser profile so you can sign in to a site once.
 *
 * The probe (scripts/ui-probe.mjs) reuses the same --profile directory, so
 * after signing in here every later run is automatic and headless.
 *
 * Attaching to your normal Chrome is not an option: Chrome 136+ refuses
 * --remote-debugging-port on the default user-data-dir, and App-Bound
 * Encryption (Chrome 127+) stops a copied cookie DB from decrypting
 * elsewhere. Both are deliberate. Signing in once here is the way round it.
 *
 *   node scripts/probe-login.mjs --url https://chatgpt.com
 *
 * Sign in, then just close the window — it exits on its own.
 */
import { execSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"

const req = createRequire(import.meta.url)
const arg = (n, d = null) => {
  const i = process.argv.indexOf("--" + n)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}
let pw
for (const c of [
  arg("playwright"),
  process.env.PLAYWRIGHT_PATH,
  "playwright",
  path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"),
]) {
  if (!c) continue
  try {
    pw = req(c)
    break
  } catch {
    /* try next */
  }
}
if (!pw) {
  console.error("playwright not found; npm i -g playwright")
  process.exit(1)
}

const { chromium, devices } = pw
const URL_ = arg("url", "https://chatgpt.com")
const PROFILE = arg("profile", ".probe-profile-chatgpt")
const DEVICE = arg("device", "iPhone 13")
const REGISTER_EMAIL = arg("register-email")
const REGISTER_PASSWORD = arg("register-password")
const HEADLESS = process.argv.includes("--headless")

const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...(devices[DEVICE] || devices["iPhone 13"]),
  headless: HEADLESS,
  isMobile: true,
  hasTouch: true,
})
const page = ctx.pages()[0] || (await ctx.newPage())
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 90000 })

if (REGISTER_EMAIL && REGISTER_PASSWORD) {
  const switchMode = page.getByRole("button", {
    name: /create an account/i,
  })
  await switchMode.waitFor({ timeout: 30000 })
  await switchMode.click()
  await page.getByLabel("Email").fill(REGISTER_EMAIL)
  await page.getByLabel("Password").fill(REGISTER_PASSWORD)
  await page.getByRole("button", { name: /sign up/i }).click()
  await page.locator("#prompt-textarea").waitFor({ timeout: 30000 })
  console.log("  Registered and saved the OpenChat session in " + PROFILE)
  await ctx.close()
  process.exit(0)
}

console.log("")
console.log("  Browser open at " + URL_)
console.log("  Profile: " + PROFILE)
console.log(
  "  Sign in, then close the window. The session is saved for the probe."
)
console.log("")

await new Promise((resolve) => {
  ctx.on("close", resolve)
  page.on("close", resolve)
})
console.log("  Saved. Now run the probe with the same --profile.")
