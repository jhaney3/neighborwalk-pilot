import { notFound, redirect } from "next/navigation";
import { validAppSegments } from "../../../lib/app-routes";
export default async function WorkspacePage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  if (!section?.length) redirect("/app/today");
  if (!validAppSegments(section)) notFound();
  // The persistent workspace layout owns the offline store. Route changes must
  // not remount the store or interrupt a pending IndexedDB transaction.
  return null;
}
