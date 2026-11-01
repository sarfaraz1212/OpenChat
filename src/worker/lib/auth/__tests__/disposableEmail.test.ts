import { describe, expect, it } from "vitest"
import { disposableDomains, isDisposableEmail } from "../disposableEmail"
import { canonicalizeEmail, normalizeEmail } from "../emailIdentity"

describe("isDisposableEmail", () => {
  it("blocks yopmail", () => {
    expect(isDisposableEmail("test@yopmail.com")).toBe(true)
  })

  it("blocks common throwaway providers", () => {
    for (const e of [
      "a@mailinator.com",
      "a@guerrillamail.com",
      "a@10minutemail.com",
      "a@temp-mail.org",
    ]) {
      expect(isDisposableEmail(e), e).toBe(true)
    }
  })

  it("blocks subdomains of a listed provider", () => {
    // Services hand out user@foo.mailinator.com while only the apex is listed.
    expect(isDisposableEmail("a@foo.mailinator.com")).toBe(true)
  })

  it("blocks RFC-reserved placeholder domains", () => {
    // Upstream only catalogues disposable services, so these never appear
    // there — but they are what people actually type into a signup form.
    for (const e of [
      "a@example.com",
      "a@example.org",
      "a@example.net",
      "a@example.edu",
      "a@sub.example.com",
    ]) {
      expect(isDisposableEmail(e), e).toBe(true)
    }
  })

  it("blocks reserved TLDs at any depth", () => {
    for (const e of [
      "a@foo.test",
      "a@foo.invalid",
      "a@mail.corp.invalid",
      "a@thing.localhost",
      "a@printer.local",
      "a@anything.example",
    ]) {
      expect(isDisposableEmail(e), e).toBe(true)
    }
  })

  it("does not over-block real domains that merely look similar", () => {
    // `example` only counts as a TLD, not as a label anywhere in the name.
    for (const e of [
      "a@example.co.uk",
      "a@myexample.com",
      "a@testing.com",
      "a@localhost.com",
    ]) {
      expect(isDisposableEmail(e), e).toBe(false)
    }
  })

  it("allows mainstream providers", () => {
    for (const e of [
      "a@gmail.com",
      "a@outlook.com",
      "a@icloud.com",
      "a@proton.me",
      "a@yahoo.com",
      "a@company.co.uk",
    ]) {
      expect(isDisposableEmail(e), e).toBe(false)
    }
  })

  it("is case and whitespace insensitive", () => {
    expect(isDisposableEmail("  TEST@YOPMAIL.COM  ")).toBe(true)
  })

  it("returns false for unparseable input rather than blocking it", () => {
    // Rejecting malformed input is the validator's job. Returning true here
    // would surface a confusing "use a permanent email" error for a typo.
    for (const e of ["", "not-an-email", "@nolocal.com", "trailing@"]) {
      expect(isDisposableEmail(e), e).toBe(false)
    }
  })
})

describe("blocklist guard", () => {
  // This list gates signup. A bad upstream merge that added a mainstream
  // provider would lock every new registration out of the product.
  const MUST_NOT_CONTAIN = [
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "yahoo.com",
    "icloud.com",
    "me.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
    "zoho.com",
    "fastmail.com",
    "hey.com",
    "qq.com",
  ]

  it("contains no mainstream provider", () => {
    const set = disposableDomains()
    for (const d of MUST_NOT_CONTAIN) {
      expect(set.has(d), d).toBe(false)
    }
  })

  it("is large enough to be the real list", () => {
    expect(disposableDomains().size).toBeGreaterThan(7000)
  })

  it("contains no bare public suffix", () => {
    // The parent walk stops at two labels, which is only safe while no public
    // suffix appears in the list.
    for (const s of ["co.uk", "com", "org", "net", "com.au"]) {
      expect(disposableDomains().has(s), s).toBe(false)
    }
  })
})

describe("email identity vs canonicalization", () => {
  it("normalizeEmail only lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Gmail.COM ")).toBe("foo@gmail.com")
    // Identity must NOT strip the +tag — these are legitimately two accounts.
    expect(normalizeEmail("a+work@gmail.com")).toBe("a+work@gmail.com")
  })

  it("canonicalizeEmail collapses gmail aliases for abuse checks only", () => {
    expect(canonicalizeEmail("a+work@gmail.com")).toBe("a@gmail.com")
    expect(canonicalizeEmail("a.b.c@gmail.com")).toBe("abc@gmail.com")
    expect(canonicalizeEmail("a@googlemail.com")).toBe("a@gmail.com")
  })

  it("does not strip dots outside gmail", () => {
    // Other providers treat dots as significant; stripping them everywhere
    // would merge unrelated people into one account.
    expect(canonicalizeEmail("a.b@outlook.com")).toBe("a.b@outlook.com")
  })

  it("never returns an empty local part", () => {
    expect(canonicalizeEmail("+foo@gmail.com")).toBe("+foo@gmail.com")
  })
})
