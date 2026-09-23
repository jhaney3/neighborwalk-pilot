export type ToastTone = "success" | "info" | "error";
export type Toast = { message: string; tone: ToastTone };

const MAX_TOAST_CHARACTERS = 48;

export function compactToastMessage(message: string) {
  const normalized = message.trim().split(/\s+/u).filter(Boolean).join(" ");
  if (normalized.length <= MAX_TOAST_CHARACTERS) return normalized;
  return normalized.slice(0, MAX_TOAST_CHARACTERS - 1).trimEnd() + "…";
}
