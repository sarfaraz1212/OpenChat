/**
 * Measures how a chat UI actually behaves in a mobile viewport.
 *
 * Point it at ChatGPT to learn the target behaviour, then at OpenChat to see
 * where we differ — the output shape is identical for both, so the two JSON
 * files diff cleanly.
 *
 * It reports the things that decide whether a chat "feels right" on a phone:
 *   - which element scrolls, and whether the document itself scrolls (it
 *     should not — that is what carries the composer off screen)
 *   - what the composer is pinned with, and how tall the layout thinks it is
 *   - where the viewport lands after a send: ChatGPT pulls the new user turn
 *     to the top of the screen rather than jamming to the bottom
 *   - how much bottom padding the list reserves, so a short reply can still
 *     scroll clear of the composer
 *
 * Usage:
 *   node scripts/ui-probe.mjs --url https://chatgpt.com --send "write a haiku"
 *   node scripts/ui-probe.mjs --url http://localhost:3000 --out probe-openchat
 *
 * ChatGPT needs a login. The browser profile persists in --profile (default
 * .probe-profile), so log in once on the first headed run and later runs reuse
 * it. Nothing is transmitted anywhere except the site being probed.
 */
import { execSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

// Playwright is deliberately NOT a dependency of this project: its postinstall
// downloads ~150MB of browsers, and Cloudflare Workers Builds runs a full
// install on every deploy. Resolve it from wherever it happens to live instead.
//
//   npm i -g playwright          (then: node scripts/ui-probe.mjs …)
//   or: PLAYWRIGHT_PATH=/abs/path/to/node_modules/playwright node scripts/…
//
// createRequire is used rather than a bare import because CommonJS resolution
// honours NODE_PATH, which ESM import does not.
const require_ = createRequire(import.meta.url)

// Try every plausible location rather than making the caller export an env var
// — the bash-style `VAR=x node …` prefix silently does nothing in PowerShell,
// which just yields a confusing "could not load" with no clue why.
function loadPlaywright() {
  const argPath = (() => {
    const i = process.argv.indexOf("--playwright")
    return i !== -1 ? process.argv[i + 1] : null
  })()

  const candidates = [argPath, process.env.PLAYWRIGHT_PATH, "playwright"]

  // …plus the global npm root, where `npm i -g playwright` puts it.
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim()
    if (root) candidates.push(path.join(root, "playwright"))
  } catch {
    /* npm not on PATH; the other candidates may still work */
  }

  const tried = []
  for (const c of candidates) {
    if (!c) continue
    try {
      return { pw: require_(c), from: c }
    } catch {
      tried.push(c)
    }
  }
  return { pw: null, tried }
}

const loaded = loadPlaywright()
if (!loaded.pw) {
  console.error(
    "Could not load playwright. Looked in:\n" +
      loaded.tried.map((t) => "    " + t).join("\n") +
      "\n\n  Fix with either:\n" +
      "    npm i -g playwright ; npx playwright install chromium\n" +
      "  or pass the path directly (works in any shell):\n" +
      "    node scripts/ui-probe.mjs --playwright C:/path/to/node_modules/playwright\n"
  )
  process.exit(1)
}
const { chromium, devices } = loaded.pw

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf("--" + name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes("--" + name)

const URL_ = arg("url", "https://chatgpt.com")
const SEND = arg("send", "Write a 200 word paragraph about the ocean.")
const OUT = arg("out", "probe-" + new URL(URL_).hostname.replace(/\W+/g, "-"))
const PROFILE = arg("profile", ".probe-profile")
const DEVICE = arg("device", "iPhone 13")
const HEADLESS = has("headless")
const LOGIN_WAIT_MS = Number(arg("login-wait", 180000))
// Attach to an already-running Chrome instead of launching a throwaway
// profile, so the probe inherits whatever the user is already logged into.
const CDP = arg("cdp", null)
// Presence of a composer does not mean signed in — logged-out ChatGPT has
// one too. Use this to block until the sign-in controls actually disappear.
const REQUIRE_LOGIN = has("require-login")
const VERIFY_RELOAD = has("verify-reload")
const INSPECT_ONLY = has("inspect-only")

/* ── measurement, evaluated inside the page ─────────────────────────────── */

// Describes the layout: what scrolls, what is pinned, and the geometry of the
// parts a chat screen is built from.
function SNAPSHOT() {
  const boxOf = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      bottomGap: Math.round(window.innerHeight - r.bottom),
    }
  }
  const styleOf = (el, keys) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const out = {}
    for (const k of keys) out[k] = cs[k] || null
    return out
  }
  const describe = (el) => {
    if (!el) return null
    let cls
    try {
      cls = (el.className && el.className.toString()) || ""
    } catch {
      cls = ""
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: cls.slice(0, 140) || null,
      testid: el.getAttribute ? el.getAttribute("data-testid") : null,
    }
  }

  // The composer: whatever the user types into.
  const input =
    document.querySelector("#prompt-textarea") ||
    document.querySelector("[contenteditable='true']") ||
    document.querySelector("form textarea") ||
    document.querySelector("textarea")

  // Walk up from the input to the element that forms the visible composer bar.
  let composer = input
  for (let i = 0; i < 6 && composer && composer.parentElement; i++) {
    const p = composer.parentElement
    if (p.getBoundingClientRect().width >= innerWidth * 0.9) {
      composer = p
      break
    }
    composer = p
  }

  // What actually keeps the composer on screen is rarely the bar itself — it is
  // some ancestor with position fixed/sticky. Find that, or say there is none.
  let pinned = null
  for (let el = input; el && el !== document.body; el = el.parentElement) {
    const pos = getComputedStyle(el).position
    if (pos === "fixed" || pos === "sticky") {
      pinned = el
      break
    }
  }

  // Every element that can actually scroll vertically right now.
  const scrollers = Array.from(document.querySelectorAll("*"))
    .filter((el) => {
      const cs = getComputedStyle(el)
      return (
        /(auto|scroll)/.test(cs.overflowY) &&
        el.scrollHeight - el.clientHeight > 4 &&
        el.clientHeight > 120
      )
    })
    .slice(0, 6)
    .map((el) => {
      const cs = getComputedStyle(el)
      return Object.assign(describe(el), {
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        scrollTop: Math.round(el.scrollTop),
        distanceFromBottom: Math.round(
          el.scrollHeight - el.scrollTop - el.clientHeight
        ),
        overflowY: cs.overflowY,
        overscrollBehavior: cs.overscrollBehavior,
        paddingBottom: cs.paddingBottom,
        height: cs.height,
      })
    })

  // Message turns. Selector names churn, so try several and keep whichever
  // finds the most — a stale guess silently reporting zero turns is worse than
  // a slightly loose one.
  const TURN_SELECTORS = [
    // ChatGPT serves a separate mobile web app ("wm-") to phone user-agents,
    // whose transcript is an <ol data-conversation-transcript> of
    // <li data-message-role>. None of the desktop selectors exist there.
    "[data-conversation-transcript] > li",
    "li[data-message-role]",
    "[data-testid^='conversation-turn']",
    "[data-message-author-role]",
    "[data-message-id]",
    "article[data-turn]",
    "article",
    "[data-role]",
  ]
  let turns = []
  let turnSelector = null
  for (const sel of TURN_SELECTORS) {
    const found = Array.from(document.querySelectorAll(sel))
    if (found.length > turns.length) {
      turns = found
      turnSelector = sel
    }
  }

  const lastTurns = turns.slice(-6).map((el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      role:
        el.getAttribute("data-message-role") ||
        el.getAttribute("data-message-author-role") ||
        el.getAttribute("data-role") ||
        null,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      w: Math.round(r.width),
      marginBottom: cs.marginBottom,
      text: (el.innerText || "").trim().slice(0, 48),
    }
  })

  const de = document.documentElement
  if (de.scrollHeight - de.clientHeight > 4) {
    scrollers.unshift({
      tag: "documentElement",
      id: null,
      cls: "(the page itself)",
      testid: null,
      clientH: de.clientHeight,
      scrollH: de.scrollHeight,
      scrollTop: Math.round(window.scrollY),
      distanceFromBottom: Math.round(
        de.scrollHeight - window.scrollY - de.clientHeight
      ),
      overflowY: getComputedStyle(de).overflowY,
      overscrollBehavior: getComputedStyle(de).overscrollBehavior,
      paddingBottom: getComputedStyle(document.body).paddingBottom,
      height: getComputedStyle(de).height,
    })
  }
  const header =
    document.querySelector("header") ||
    document.querySelector("[role='banner']")

  return {
    viewport: {
      innerW: innerWidth,
      innerH: innerHeight,
      visualH: Math.round(
        (window.visualViewport && visualViewport.height) || 0
      ),
      dpr: devicePixelRatio,
    },
    document: {
      scrollH: de.scrollHeight,
      clientH: de.clientHeight,
      canScroll: de.scrollHeight - de.clientHeight > 4,
      htmlHeight: getComputedStyle(de).height,
      htmlOverflow: getComputedStyle(de).overflow,
      bodyHeight: getComputedStyle(document.body).height,
      bodyOverflow: getComputedStyle(document.body).overflow,
      bodyPosition: getComputedStyle(document.body).position,
    },
    scrollers,
    composer: {
      el: describe(composer),
      box: boxOf(composer),
      style: styleOf(composer, [
        "position",
        "bottom",
        "zIndex",
        "paddingBottom",
        "transform",
      ]),
      inputEl: describe(input),
      inputBox: boxOf(input),
      inputStyle: styleOf(input, ["maxHeight", "height", "overflowY"]),
      pinnedAncestor: describe(pinned),
      pinnedBox: boxOf(pinned),
      pinnedStyle: styleOf(pinned, [
        "position",
        "bottom",
        "zIndex",
        "paddingBottom",
      ]),
    },
    header: {
      el: describe(header),
      box: boxOf(header),
      style: styleOf(header, ["position", "top", "zIndex"]),
    },
    turns: { selector: turnSelector, count: turns.length, last: lastTurns },
  }
}

/* ── driver ─────────────────────────────────────────────────────────────── */

const log = (...a) => console.log(...a)

async function main() {
  await mkdir(OUT, { recursive: true })
  const device = devices[DEVICE] || devices["iPhone 13"]

  let ctx
  let page
  let browser = null

  if (CDP) {
    // Attach to the browser the user already has open and logged in.
    //
    // It has to be the DEFAULT context: newContext() would be a fresh profile
    // with none of their cookies, which defeats the point. That rules out
    // Playwright's device presets (they only apply at context creation), so
    // mobile emulation is applied per-page over CDP instead.
    browser = await chromium.connectOverCDP(CDP)
    ctx = browser.contexts()[0]
    if (!ctx)
      throw new Error("Connected, but that browser has no context open.")
    page = await ctx.newPage()

    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: device.viewport.width,
      height: device.viewport.height,
      deviceScaleFactor: device.deviceScaleFactor || 3,
      mobile: true,
    })
    await cdp.send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    })
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent: device.userAgent,
    })
    log("attached to your browser at " + CDP + " (using its logged-in session)")
  } else {
    ctx = await chromium.launchPersistentContext(PROFILE, {
      ...device,
      headless: HEADLESS,
      isMobile: true,
      hasTouch: true,
    })
    page = ctx.pages()[0] || (await ctx.newPage())
  }

  const shots = []
  const shot = async (name) => {
    const f = path.join(OUT, name + ".png")
    await page.screenshot({ path: f })
    shots.push(f)
  }

  const SELECTOR = "#prompt-textarea, [contenteditable='true'], textarea"

  log(
    "→ " +
      URL_ +
      "  (" +
      DEVICE +
      ": " +
      device.viewport.width +
      "x" +
      device.viewport.height +
      ")"
  )
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForTimeout(3000)

  if ((await page.locator(SELECTOR).count()) === 0) {
    if (HEADLESS) {
      throw new Error("No composer found. Run headed once and log in first.")
    }
    log("\n  No composer found — log in in the browser window that opened.")
    log("  Waiting up to " + Math.round(LOGIN_WAIT_MS / 1000) + "s…\n")
    await page.locator(SELECTOR).first().waitFor({ timeout: LOGIN_WAIT_MS })
    log("  Composer found — continuing.\n")
  }

  if (REQUIRE_LOGIN) {
    const loggedOut = () =>
      page
        .locator(
          "button:has-text('Log in'), a:has-text('Log in'), " +
            "button:has-text('Sign up'), a:has-text('Sign up')"
        )
        .first()
        .isVisible()
        .catch(() => false)

    if (await loggedOut()) {
      log("")
      log("  Not signed in. Log in in the browser window that opened.")
      log("  Waiting up to " + Math.round(LOGIN_WAIT_MS / 1000) + "s...")
      log("")
      const deadline = Date.now() + LOGIN_WAIT_MS
      while (Date.now() < deadline && (await loggedOut())) {
        await page.waitForTimeout(2000)
      }
      if (await loggedOut()) throw new Error("Still signed out - giving up.")
      log("  Signed in - continuing.")
      await page.waitForTimeout(2500)
    }
  }

  const report = {
    url: URL_,
    device: DEVICE,
    capturedAt: new Date().toISOString(),
  }

  report.idle = await page.evaluate(SNAPSHOT)
  await shot("1-idle")
  log("captured: idle")

  if (INSPECT_ONLY) {
    report.screenshots = shots
    const out = path.join(OUT, "report.json")
    await writeFile(out, JSON.stringify(report, null, 2))
    log("\nwrote " + out)
    if (browser) {
      await page.close()
      await browser.close()
    } else {
      await ctx.close()
    }
    return
  }

  // Send a message the way a person does.
  const input = page.locator(SELECTOR).first()
  await input.click()
  try {
    await input.fill(SEND)
  } catch {
    await page.keyboard.type(SEND, { delay: 10 })
  }
  await page.waitForTimeout(400)
  report.typed = await page.evaluate(SNAPSHOT)
  await shot("2-typed")
  log("captured: typed")

  // Enter is not reliable: ChatGPT's composer is a contenteditable where Enter
  // can insert a newline instead of submitting, which silently left the message
  // sitting in the box. Prefer a real send button and fall back to Enter.
  const turnsBefore = report.typed.turns.count
  const sendButton = page
    .locator(
      "[data-testid='send-button'], button[aria-label*='Send' i], " +
        "form button[type='submit']"
    )
    .first()

  let clicked = false
  if ((await sendButton.count()) > 0) {
    try {
      await sendButton.click({ timeout: 4000 })
      clicked = true
    } catch {
      /* fall through to Enter */
    }
  }
  if (!clicked) await page.keyboard.press("Enter")

  // Confirm it actually sent rather than measuring an unsent composer.
  await page.waitForFunction(
    (before) => {
      const sels = [
        "[data-conversation-transcript] > li",
        "[data-testid^='conversation-turn']",
        "[data-message-author-role]",
        "[data-message-id]",
        "article",
      ]
      const n = Math.max(
        ...sels.map((s) => document.querySelectorAll(s).length)
      )
      return n > before
    },
    turnsBefore,
    { timeout: 20000 }
  )
  log("  send confirmed (" + (clicked ? "button" : "Enter") + ")")

  if (VERIFY_RELOAD) {
    await page.locator("[data-streaming='true']").waitFor({
      state: "visible",
      timeout: 20000,
    })
    log("  streaming assistant turn observed")
  }

  // The moment after send is where the interesting scroll behaviour lives.
  await page.waitForTimeout(700)
  report.justSent = await page.evaluate(SNAPSHOT)
  await shot("3-just-sent")
  log("captured: just-sent")

  await page.waitForTimeout(2500)
  report.streaming = await page.evaluate(SNAPSHOT)
  await shot("4-streaming")
  log("captured: streaming")

  await page.waitForTimeout(12000)
  report.settled = await page.evaluate(SNAPSHOT)
  await shot("5-settled")
  log("captured: settled")

  if (VERIFY_RELOAD) {
    const assertExchange = (snapshot, label) => {
      const recent = snapshot.turns.last
      const promptStart = SEND.trim().slice(0, 24)
      const userTurn = recent.find(
        (turn) => turn.role === "user" && turn.text.includes(promptStart)
      )
      const assistantTurn = recent.find(
        (turn) => turn.role === "assistant" && turn.text.trim().length > 0
      )
      if (
        snapshot.turns.count < turnsBefore + 2 ||
        !userTurn ||
        !assistantTurn
      ) {
        throw new Error(
          `${label} did not contain the sent user turn and a non-empty assistant reply.`
        )
      }
    }

    assertExchange(report.settled, "Settled conversation")
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForTimeout(3000)
    report.reloaded = await page.evaluate(SNAPSHOT)
    await shot("5b-reloaded")
    log("captured: reloaded")
    assertExchange(report.reloaded, "Reloaded conversation")
  }

  // Does it stay pinned if the user scrolls up? (auto-follow vs release)
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find((e) => {
      const cs = getComputedStyle(e)
      return (
        /(auto|scroll)/.test(cs.overflowY) &&
        e.scrollHeight - e.clientHeight > 4 &&
        e.clientHeight > 120
      )
    })
    if (el) el.scrollTop = Math.max(0, el.scrollTop - 400)
  })
  await page.waitForTimeout(900)
  report.afterScrollUp = await page.evaluate(SNAPSHOT)
  await shot("6-scrolled-up")
  log("captured: scrolled-up")

  report.screenshots = shots
  const out = path.join(OUT, "report.json")
  await writeFile(out, JSON.stringify(report, null, 2))
  log("\nwrote " + out)
  log("screenshots: " + shots.join(", "))

  if (browser) {
    await page.close()
    await browser.close() // detaches from CDP; does not quit their browser
  } else {
    await ctx.close()
  }
}

main().catch((err) => {
  console.error("probe failed:", err.message)
  process.exit(1)
})
