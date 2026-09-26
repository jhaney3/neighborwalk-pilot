"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Focuses a field the person just asked to edit (a tap on the address, "Add a
 * note", Search). Never used to grab focus on its own. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return ref;
}

/** An iOS bottom sheet: a grabber, swipe down (or Escape) to dismiss, and
 * scrollable content that stays clear of the home indicator. Map sheets are
 * not modal, so the map stays live around them: tapping away is handled by the
 * map. Modal sheets dim what's behind them, and tapping the dim dismisses. */
export function Sheet({ label, labelledBy, modal = false, detent = "fit", className, onDismiss, children }: {
  label?: string;
  labelledBy?: string;
  modal?: boolean;
  /** "medium" opens part way, like an iOS sheet detent, and grows to full
   * height when its content scrolls or the grabber is dragged up. */
  detent?: "fit" | "medium" | "large";
  className?: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(detent === "large");
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; pointerId: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) dismissRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    // VoiceOver starts on the sheet, not on whatever was focused behind it.
    sheet.current?.focus({ preventScroll: true });
  }, []);
  const begin = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { startY: event.clientY, pointerId: event.pointerId };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    setOffset(Math.max(0, event.clientY - drag.current.startY));
  };
  const end = (event: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const moved = event.clientY - drag.current.startY;
    drag.current = null;
    setOffset(0);
    if (moved < -24) setExpanded(true);
    else if (moved > 72) { if (expanded && detent === "medium") setExpanded(false); else onDismiss(); }
  };
  return <>
    {modal && <button type="button" className="sheet-dim" aria-label="Close" tabIndex={-1} onClick={onDismiss} />}
    <section ref={sheet} className={`sheet${modal ? " modal" : ""}${detent === "medium" ? " medium" : ""}${expanded ? " expanded" : ""}${className ? ` ${className}` : ""}`} role="dialog" aria-modal={modal || undefined} aria-label={label} aria-labelledby={labelledBy} tabIndex={-1}
      style={offset ? { transform: `translateY(${offset}px)`, transition: "none" } : undefined}>
      <div className="sheet-grabber" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true"><span /></div>
      <div className="sheet-body" onScroll={detent === "medium" && !expanded ? (event) => { if (event.currentTarget.scrollTop > 6) setExpanded(true); } : undefined}>{children}</div>
    </section>
  </>;
}

export type SheetAction = { label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean };

/** An iOS action sheet: one group of actions, then a separate Cancel or Close.
 * Destructive actions are red; the caller confirms them when they can't be undone. */
export function ActionSheet({ title, actions, closeLabel = "Cancel", onClose }: { title?: string; actions: SheetAction[]; closeLabel?: string; onClose: () => void }) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <>
    <button type="button" className="sheet-dim action-dim" aria-label={closeLabel} tabIndex={-1} onClick={onClose} />
    <div className="action-sheet" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "Options"}>
      <div className="action-sheet-group">
        {title && <p className="action-sheet-title mono-meta" id={titleId}>{title}</p>}
        {actions.map((action, index) => <button key={action.label} ref={index === 0 ? first : undefined} type="button" className={action.destructive ? "destructive" : undefined} disabled={action.disabled} onClick={action.onSelect}>{action.label}</button>)}
      </div>
      <div className="action-sheet-group">
        <button type="button" className="action-sheet-close" onClick={onClose}>{closeLabel}</button>
      </div>
    </div>
  </>;
}
