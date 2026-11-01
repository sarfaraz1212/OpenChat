function toContentString(value: unknown): string | null {
  if (typeof value === "string" || value === null || value === undefined) {
    return null
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object") {
          const text = (part as Record<string, unknown>).text
          return typeof text === "string" ? text : ""
        }
        return ""
      })
      .join("")
  }
  if (typeof value === "object") {
    const text = (value as Record<string, unknown>).text
    return typeof text === "string" ? text : ""
  }
  return ""
}

function repairPayload(node: unknown): unknown {
  if (!node || typeof node !== "object") return node
  const object = node as Record<string, unknown>
  if (!Array.isArray(object.choices)) return object
  for (const choice of object.choices) {
    if (!choice || typeof choice !== "object") continue
    for (const key of ["delta", "message"] as const) {
      const slot = (choice as Record<string, unknown>)[key]
      if (!slot || typeof slot !== "object") continue
      const content = slot as Record<string, unknown>
      const repaired = toContentString(content.content)
      if (repaired !== null) content.content = repaired
    }
  }
  return object
}

function repairSseLine(line: string): string {
  if (!line.startsWith("data:")) return line
  const raw = line.slice(5).trim()
  if (raw === "" || raw === "[DONE]") return line
  try {
    return `data: ${JSON.stringify(repairPayload(JSON.parse(raw)))}`
  } catch {
    return line
  }
}

function createSseRepairStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      if (lines.length > 0) {
        controller.enqueue(
          encoder.encode(`${lines.map(repairSseLine).join("\n")}\n`)
        )
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(repairSseLine(buffer)))
    },
  })
}

export function createRepairingFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init)
    if (!response.ok || !response.body) return response
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      return new Response(response.body.pipeThrough(createSseRepairStream()), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    if (contentType.includes("application/json")) {
      const text = await response.text()
      let repaired = text
      try {
        repaired = JSON.stringify(repairPayload(JSON.parse(text)))
      } catch {
        // Pass unknown upstream payloads through byte-for-byte.
      }
      return new Response(repaired, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    return response
  }
}
