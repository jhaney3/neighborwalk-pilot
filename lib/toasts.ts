const MAX_TOAST_WORDS = 2;

export function compactToastMessage(message: string) {
  return message.trim().split(/\s+/u).filter(Boolean).slice(0, MAX_TOAST_WORDS).join(" ");
}
