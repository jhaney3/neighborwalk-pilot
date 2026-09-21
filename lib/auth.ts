export function validAuthEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

export function authErrorMessage(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const message = typeof candidate?.message === "string"
    ? candidate.message
    : typeof error === "string" ? error : "Sign-in could not be completed.";
  const normalized = message.toLowerCase();

  if (code === "over_email_send_rate_limit" || normalized.includes("email rate limit") || normalized.includes("rate limit for sending emails")) {
    return "Email sending is temporarily limited. Sign in with Apple, Google, or your password, or try email again after the limit resets.";
  }
  if (code === "invalid_credentials" || normalized.includes("invalid login credentials")) {
    return "That email and password do not match. Try again or reset your password.";
  }
  if (normalized.includes("password should be at least")) {
    return "Use a password with at least 8 characters.";
  }
  return message;
}
