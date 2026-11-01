/**
 * Probes each Workers AI backend for STREAMING tool-call support and vision.
 *
 * Workers AI advertises a `tools` property for every model, and non-streaming
 * requests do return proper `tool_calls` — but under `stream: true` several
 * models emit the call as raw JSON in `delta.content` instead, which renders to
 * the user as a wall of JSON. The only way to know is to stream a real call, so
 * that is what this does. Results feed the `tools` / `vision` flags in
 * lib/models/data/cloudflare.ts.
 *
 * Usage: node scripts/probe-tools.mjs [modelId ...]
 */
import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"

const BACKENDS = [
  "@cf/zai-org/glm-5.3",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/openai/gpt-oss-120b",
  "@cf/openai/gpt-oss-20b",
  "@cf/qwen/qwen3.8-27b",
]

function loadEnv() {
  const env = {}
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) env[m[1]] = m[2]
    }
  } catch {
    // fall through to process.env
  }
  return {
    account: process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN,
  }
}

/** Minimal 16x16 solid-red PNG — some models reject a 1x1. */
function redPng() {
  const w = 16
  const h = 16
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3)
    raw[row] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = 0xd0
      raw[row + 2 + x * 3] = 0x21
      raw[row + 3 + x * 3] = 0x21
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const cs = Buffer.alloc(4)
    cs.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, cs])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64")
}

const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
}

async function stream({ account, token }, body) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, stream: true, max_tokens: 512 }),
    }
  )

  if (!res.ok) {
    return { httpError: `${res.status} ${(await res.text()).slice(0, 180)}` }
  }

  let text = ""
  let sawToolCall = false
  const buf = []
  const decoder = new TextDecoder()
  let pending = ""

  for await (const part of res.body) {
    pending += decoder.decode(part, { stream: true })
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === "[DONE]") continue
      buf.push(payload)
      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      const delta = json.choices?.[0]?.delta
      if (!delta) continue
      if (delta.tool_calls) sawToolCall = true
      if (typeof delta.content === "string") text += delta.content
    }
  }
  return { text, sawToolCall, raw: buf.length }
}

/** A leaked call shows up as JSON/XML-ish tool syntax in the visible text. */
function looksLeaked(text) {
  return (
    /"?(name|function)"?\s*[:=]\s*"?get_weather/i.test(text) ||
    /<\s*(tool_call|function_call|invoke)/i.test(text) ||
    /```\s*json[\s\S]*get_weather/i.test(text)
  )
}

async function probe(creds, model) {
  const row = { model, tools: "?", vision: "?", note: "" }

  try {
    const r = await stream(creds, {
      model,
      messages: [
        {
          role: "user",
          content: "What is the weather in Paris? Use the get_weather tool.",
        },
      ],
      tools: [WEATHER_TOOL],
    })
    if (r.httpError) {
      row.tools = "ERR"
      row.note = r.httpError
    } else if (r.sawToolCall) {
      row.tools = "yes"
    } else if (looksLeaked(r.text)) {
      row.tools = "LEAK"
      row.note = r.text.replace(/\s+/g, " ").slice(0, 90)
    } else {
      row.tools = "no-call"
      row.note = r.text.replace(/\s+/g, " ").slice(0, 90)
    }
  } catch (err) {
    row.tools = "ERR"
    row.note = String(err.message ?? err).slice(0, 120)
  }

  try {
    const r = await stream(creds, {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this image? One word." },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${redPng()}` },
            },
          ],
        },
      ],
    })
    // Accepting the content array is not the same as seeing the image: a
    // text-only model can return 200 and answer around it. Require the model to
    // actually name the colour.
    if (r.httpError) {
      row.vision = "no"
      if (!row.note) row.note = `vision: ${r.httpError}`
    } else if (/\bred\b|crimson|scarlet/i.test(r.text)) {
      row.vision = "yes"
    } else {
      row.vision = "blind"
      row.note = `vision said: ${r.text.replace(/\s+/g, " ").slice(0, 80)}`
    }
  } catch {
    row.vision = "no"
  }

  return row
}

const creds = loadEnv()
if (!creds.account || !creds.token) {
  console.error("Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN")
  process.exit(1)
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : BACKENDS

const rows = []
for (const model of targets) {
  process.stderr.write(`probing ${model} ... `)
  const row = await probe(creds, model)
  process.stderr.write(`tools=${row.tools} vision=${row.vision}\n`)
  rows.push(row)
}

console.log("\n| backend | tools | vision | note |")
console.log("|---|---|---|---|")
for (const r of rows) {
  console.log(
    `| ${r.model} | ${r.tools} | ${r.vision} | ${r.note.replace(/\|/g, "/")} |`
  )
}
