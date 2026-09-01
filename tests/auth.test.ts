import { describe, expect, it } from "vitest";
import { authErrorMessage, validAuthEmail } from "../lib/auth";

describe("authentication guidance", () => {
  it("recognizes usable email addresses", () => {
    expect(validAuthEmail(" volunteer@example.org ")).toBe(true);
    expect(validAuthEmail("not-an-email")).toBe(false);
  });

  it("turns the Supabase email limit into an actionable sign-in choice", () => {
    expect(authErrorMessage({ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" }))
      .toContain("Sign in with Google or your password");
  });

  it("makes invalid password credentials understandable", () => {
    expect(authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }))
      .toBe("That email and password do not match. Try again or reset your password.");
  });
});
