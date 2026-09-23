"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

export function Modal({ title, description, wide = false, mobileImmersive = false, role, onClose, children }: { title: string; description?: string; wide?: boolean; mobileImmersive?: boolean; role?: "alertdialog"; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  const requestClose = () => { if (!dialog.current?.querySelector('[aria-busy="true"]')) onClose(); };
  return <dialog ref={dialog} role={role} className={`modal-card${wide ? " wide" : ""}${mobileImmersive ? " mobile-immersive" : ""}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={(event) => { event.preventDefault(); requestClose(); }}>
    <div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="close-button" onClick={requestClose} aria-label="Close dialog"><X size={18} aria-hidden="true" /></button></div>{children}
  </dialog>;
}

export function ViewHeading({ eyebrow, title, description, aside }: { eyebrow?: string; title: string; description?: string; aside?: React.ReactNode }) {
  return <div className="view-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{aside}</div>;
}

export function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="empty-state">{icon}<h2>{title}</h2><p>{copy}</p></div>;
}

/** An inset grouped list, the default container for anything row-shaped. */
export function ListGroup({ label, footer, className, children }: { label?: React.ReactNode; footer?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <section className={`list-group${className ? ` ${className}` : ""}`}>
    {label && <h2 className="list-group-label">{label}</h2>}
    <div className="list-group-rows">{children}</div>
    {footer && <p className="list-group-footer">{footer}</p>}
  </section>;
}

type ListRowProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  value?: React.ReactNode;
  chevron?: boolean;
  tone?: "default" | "danger";
  className?: string;
} & ({ onClick: () => void; href?: never } | { href: string; onClick?: never } | { onClick?: never; href?: never });

export function ListRow({ title, subtitle, icon, value, chevron, tone = "default", className, ...target }: ListRowProps) {
  const interactive = Boolean(target.onClick || target.href);
  const content = <>
    {icon && <span className="list-row-icon" aria-hidden="true">{icon}</span>}
    <span className="list-row-text"><span className="list-row-title">{title}</span>{subtitle && <span className="list-row-subtitle">{subtitle}</span>}</span>
    {value !== undefined && value !== null && value !== false && <span className="list-row-value">{value}</span>}
    {(chevron ?? interactive) && <ChevronRight className="list-row-chevron" size={18} aria-hidden="true" />}
  </>;
  const classes = `list-row${tone === "danger" ? " danger" : ""}${className ? ` ${className}` : ""}`;
  if (target.href) return <Link className={classes} href={target.href}>{content}</Link>;
  if (target.onClick) return <button type="button" className={classes} onClick={target.onClick}>{content}</button>;
  return <div className={classes}>{content}</div>;
}

export type BadgeTone = "neutral" | "tint" | "accent" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: React.ReactNode; disabled?: boolean }[]; value: T; onChange: (value: T) => void }) {
  return <div className="segmented-control" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={option.value === value} disabled={option.disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export function BackButton({ label, onClick, ariaLabel }: { label: string; onClick: () => void; ariaLabel?: string }) {
  return <button type="button" className="back-button" onClick={onClick} aria-label={ariaLabel}><ChevronLeft size={22} aria-hidden="true" /><span>{label}</span></button>;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function Avatar({ name, size = "regular" }: { name: string; size?: "small" | "regular" | "large" }) {
  return <span className={`avatar ${size}`} aria-hidden="true">{initials(name)}</span>;
}

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

// Outside a provider (isolated harnesses), fall back to the platform prompt.
const ConfirmContext = createContext<Confirm>(async (options) => window.confirm([options.title, options.message].filter(Boolean).join("\n\n")));

/** Hosts one confirmation sheet for the app so actions can `await confirm(...)`. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; resolve: (confirmed: boolean) => void } | null>(null);
  const confirm = useCallback<Confirm>((options) => new Promise<boolean>((resolve) => {
    setRequest((current) => {
      current?.resolve(false);
      return { options, resolve };
    });
  }), []);
  const settle = (confirmed: boolean) => {
    request?.resolve(confirmed);
    setRequest(null);
  };
  return <ConfirmContext.Provider value={confirm}>
    {children}
    {request && <Modal role="alertdialog" title={request.options.title} description={request.options.message} onClose={() => settle(false)}>
      <div className="modal-actions confirm-actions">
        <button type="button" className="button quiet" onClick={() => settle(false)}>{request.options.cancelLabel ?? "Cancel"}</button>
        <button type="button" className={`button ${request.options.destructive ? "danger" : "primary"}`} onClick={() => settle(true)}>{request.options.confirmLabel}</button>
      </div>
    </Modal>}
  </ConfirmContext.Provider>;
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
