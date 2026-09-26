"use client";

import { ChevronDown, MapPin, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

/** Screens shown before a church opens (sign-in, invitations, loading and
 * problems) use the tabs' language: paper background, a left-aligned display
 * title over a mono line, filled fields and one ink button. */
export function EntryScreen({ labelledBy, className, children }: { labelledBy?: string; className?: string; children: ReactNode }) {
  return <main className={`entry-screen${className ? ` ${className}` : ""}`} aria-labelledby={labelledBy}>
    <div className="entry-column">{children}</div>
  </main>;
}

/** The app icon's pin on its hedge tile, with the offset line the cards use. */
export function EntryBrand({ name = true }: { name?: boolean }) {
  return <div className="entry-brand"><span aria-hidden="true"><MapPin size={20} strokeWidth={2.4} /></span>{name && <strong>SendMe</strong>}</div>;
}

export function EntryTitle({ id, meta, children }: { id?: string; meta?: ReactNode; children: ReactNode }) {
  return <header className="entry-title">
    <h1 className="screen-title" id={id}>{children}</h1>
    {meta && <p className="mono-meta">{meta}</p>}
  </header>;
}

export function EntryLoading({ status }: { status: string }) {
  return <main className="entry-screen entry-loading">
    <EntryBrand name={false} />
    <h1 className="visually-hidden">SendMe</h1>
    <p className="mono-meta" role="status" aria-live="polite">{status}</p>
  </main>;
}

/** A problem or a stop before the church opens: an icon, the title, what
 * happened, a mono reassurance, then the actions with the primary one first. */
export function EntryNotice({ id, icon, tone = "calm", title, reassurance, children, actions }: { id: string; icon: ReactNode; tone?: "calm" | "problem"; title: ReactNode; reassurance?: string; children?: ReactNode; actions: ReactNode }) {
  return <EntryScreen labelledBy={id} className="entry-notice">
    <span className={`entry-notice-icon ${tone}`} aria-hidden="true">{icon}</span>
    <EntryTitle id={id}>{title}</EntryTitle>
    <div className="entry-copy">{children}</div>
    {reassurance && <p className="mono-meta entry-reassurance">{reassurance}</p>}
    <div className="entry-actions">{actions}</div>
  </EntryScreen>;
}

/** One row of a grouped list that opens in place (More options on sign-in). */
export function EntryDisclosure({ icon, title, detail, children }: { icon: ReactNode; title: string; detail?: string; children: ReactNode }) {
  return <details className="entry-disclosure">
    <summary className="grouped-row custom-summary">
      {icon}
      <span className="grouped-row-text"><strong className="wrap">{title}</strong>{detail && <small>{detail}</small>}</span>
      <ChevronDown className="entry-chevron" size={17} aria-hidden="true" />
    </summary>
    <div className="entry-disclosure-body">{children}</div>
  </details>;
}

/** The app's error boundary: something broke while drawing a screen. */
export function AppCrashed() {
  return <EntryNotice id="crash-title" tone="problem" icon={<RotateCcw size={22} />} title="Let’s reopen SendMe"
    reassurance="Your saved work is still on this phone"
    actions={<button type="button" className="button-ink wide" onClick={() => window.location.reload()}>Try again</button>}>
    <p>Something went wrong on this screen.</p>
  </EntryNotice>;
}
