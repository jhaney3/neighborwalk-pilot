const dismissibleInputTypes = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

/**
 * Make the iOS Done/Return key release single-line fields. Browsers keep an
 * input focused by default, which leaves the software keyboard onscreen.
 * Do not cancel the event: forms and field-specific Enter handlers must still
 * be able to submit or select a search result before focus is released.
 */
export function installSingleLineKeyboardDismissal(documentTarget: Document = document) {
  const dismiss = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !dismissibleInputTypes.has(input.type)) return;
    if (input.hasAttribute("data-keep-keyboard-on-enter")) return;
    input.blur();
  };

  documentTarget.addEventListener("keydown", dismiss);
  return () => documentTarget.removeEventListener("keydown", dismiss);
}
