import type { GuideStep } from "../lib/domain";

export function GuideCoaching({ step, reminder = false }: { step: GuideStep; reminder?: boolean }) {
  const copy = reminder ? step.reminder : step.coaching;
  return copy ? <aside className="guide-supporting-copy"><strong>{reminder ? "Remember" : "Before you speak"}</strong><p>{copy}</p></aside> : null;
}
