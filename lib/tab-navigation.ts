import type { KeyboardEvent } from "react";

export function nextTabIndex(key: string, current: number, count: number, orientation: "horizontal" | "vertical") {
  if (count < 1 || current < 0 || current >= count) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === (orientation === "vertical" ? "ArrowDown" : "ArrowRight")) return (current + 1) % count;
  if (key === (orientation === "vertical" ? "ArrowUp" : "ArrowLeft")) return (current + count - 1) % count;
  return undefined;
}

/** Local panels are already available, so arrow navigation can activate them
 * immediately. Unrelated keys keep their normal scrolling/browser behavior. */
export function navigateTabs(event: KeyboardEvent<HTMLElement>, activate: (index: number) => void, orientation: "horizontal" | "vertical" = "horizontal") {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
  const current = tabs.findIndex((tab) => tab === event.target);
  const next = nextTabIndex(event.key, current, tabs.length, orientation);
  if (next === undefined) return;
  event.preventDefault(); activate(next); tabs[next].focus();
}
