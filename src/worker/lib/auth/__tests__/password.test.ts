import { describe, expect, it } from "vitest"
import {
  hashPassword,
  validatePasswordShape,
  verifyPassword,
} from "../password"

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true
    )
  })

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(
      false
    )
    expect(await verifyPassword("", hash)).toBe(false)
  })

  it("salts — the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password")
    const b = await hashPassword("same-password")
    expect(a).not.toBe(b)
    expect(await verifyPassword("same-password", a)).toBe(true)
    expect(await verifyPassword("same-password", b)).toBe(true)
  })

  it("encodes algorithm and iterations so cost can be raised later", async () => {
    const hash = await hashPassword("x")
    const [algo, iterations] = hash.split("$")
    expect(algo).toBe("pbkdf2")
    expect(Number(iterations)).toBeGreaterThanOrEqual(100_000)
    expect(hash.split("$")).toHaveLength(4)
  })

  it("returns false rather than throwing on malformed stored values", async () => {
    for (const bad of [
      null,
      "",
      "garbage",
      "pbkdf2$notanumber$a$b",
      "md5$1$a$b",
    ]) {
      expect(await verifyPassword("x", bad as string | null), String(bad)).toBe(
        false
      )
    }
  })

  it("handles unicode passwords", async () => {
    const pw = "pässwörd–🔐"
    const hash = await hashPassword(pw)
    expect(await verifyPassword(pw, hash)).toBe(true)
  })
})

describe("validatePasswordShape", () => {
  it("requires at least 3 characters and nothing else about their mix", () => {
    expect(validatePasswordShape("ab")).toMatch(/at least 3/)
    expect(validatePasswordShape("abc")).toBeNull()
    expect(validatePasswordShape("alllowercase")).toBeNull()
  })

  it("caps absurd lengths", () => {
    expect(validatePasswordShape("x".repeat(257))).toMatch(/256/)
  })
})
