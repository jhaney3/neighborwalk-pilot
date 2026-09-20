"use client";

import { useEffect, useId, useRef } from "react";

export function Modal({ title, description, wide = false, onClose, children }: { title: string; description?: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      previousFocus?.focus();
    };
  }, []);
  const requestClose = () => { if (!dialog.current?.querySelector('[aria-busy="true"]')) onClose(); };
  return <dialog ref={dialog} className={`modal-card${wide ? " wide" : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
    <div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="close-button" onClick={requestClose} aria-label="Close dialog">×</button></div>{children}
  </dialog>;
}

export function ViewHeading({ eyebrow, title, description, aside }: { eyebrow?: string; title: string; description?: string; aside?: React.ReactNode }) {
  return <div className="view-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{aside}</div>;
}

export function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="empty-state">{icon}<h2>{title}</h2><p>{copy}</p></div>;
}
