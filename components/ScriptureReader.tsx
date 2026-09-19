"use client";
import { serviceUrl } from "../lib/mobile";

import { BookOpenText, ChevronDown, ChevronUp, ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";

type Reading = {
  status: "loading" | "ready" | "error";
  canonical?: string;
  text?: string;
  error?: string;
};

function esvUrl(reference: string) {
  return `https://www.esv.org/${encodeURIComponent(reference)}/`;
}

export function ScriptureReader({ references, theme = "dark" }: { references: string[]; theme?: "dark" | "light" }) {
  const [activeReference, setActiveReference] = useState<string | null>(null);
  const [readings, setReadings] = useState<Record<string, Reading>>({});

  if (!references.length) return null;

  const toggleReference = async (reference: string) => {
    if (activeReference === reference) {
      setActiveReference(null);
      return;
    }
    setActiveReference(reference);
    if (readings[reference]) return;

    setReadings((current) => ({ ...current, [reference]: { status: "loading" } }));
    try {
      const response = await fetch(serviceUrl(`/api/scripture?reference=${encodeURIComponent(reference)}`));
      const payload = await response.json() as { canonical?: string; text?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "The passage could not be loaded.");
      setReadings((current) => ({ ...current, [reference]: { status: "ready", canonical: payload.canonical || reference, text: payload.text } }));
    } catch (error) {
      setReadings((current) => ({
        ...current,
        [reference]: { status: "error", error: error instanceof Error ? error.message : "The passage could not be loaded." },
      }));
    }
  };

  const reading = activeReference ? readings[activeReference] : undefined;

  return (
    <div className={`scripture-reader ${theme}`}>
      <nav className="scripture-reference-list" aria-label="Scripture references">
        <BookOpenText size={15} aria-hidden="true" />
        {references.map((reference) => {
          const active = activeReference === reference;
          return (
            <button type="button" key={reference} className={active ? "active" : ""} aria-expanded={active} onClick={() => void toggleReference(reference)}>
              {reference}{active ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          );
        })}
      </nav>
      {activeReference && (
        <div className="scripture-passage" role="region" aria-label={`${activeReference} scripture text`} aria-live="polite">
          {reading?.status === "ready" ? (
            <>
              <div className="scripture-passage-heading"><span>ESV</span><strong>{reading.canonical}</strong></div>
              <p>{reading.text}</p>
            </>
          ) : reading?.status === "error" ? (
            <div className="scripture-passage-status"><strong>This passage isn’t available here yet.</strong><span>{reading.error}</span></div>
          ) : (
            <div className="scripture-passage-status loading"><LoaderCircle className="spin" size={16} /><span>Opening {activeReference}…</span></div>
          )}
          <div className="scripture-attribution">
            <a href={esvUrl(activeReference)} target="_blank" rel="noreferrer">Read on ESV.org <ExternalLink size={12} /></a>
            {reading?.status === "ready" && <small>Scripture quotations are from the ESV® Bible, © 2001 by Crossway. Used by permission. All rights reserved.</small>}
          </div>
        </div>
      )}
    </div>
  );
}
