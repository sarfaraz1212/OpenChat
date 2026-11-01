import { describe, expect, it } from "vitest"
import { TestClient } from "../test/client"

describe("GET /api/health", () => {
  it("reports the Worker is up", async () => {
    const res = await new TestClient().get("/api/health")

    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; timestamp: string }
    expect(body.status).toBe("ok")
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })
})
