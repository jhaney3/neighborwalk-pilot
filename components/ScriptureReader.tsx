import { BookOpenText, ExternalLink } from "lucide-react";

/** Reference links deliberately avoid unlicensed embedded scripture and API calls. */
export function ScriptureReader({ references, theme = "dark" }: { references: string[]; theme?: "dark" | "light" }) {
  if (!references.length) return null;
  return <div className={`scripture-reader ${theme}`}>
    <div className="scripture-reference-list" aria-label="Scripture references">
      <BookOpenText size={15} aria-hidden="true" />
      {references.map((reference) => <a key={reference} href={`https://www.esv.org/${encodeURIComponent(reference)}/`} target="_blank" rel="noreferrer">
        {reference} <ExternalLink size={13} aria-label="opens external Bible website" />
      </a>)}
    </div>
    <small>References open on ESV.org and require a connection. Your church’s guide text remains available when prepared offline.</small>
  </div>;
}
