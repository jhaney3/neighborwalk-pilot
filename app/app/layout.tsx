import { Suspense } from "react";
import { NeighborWalkRoot } from "../../components/SupabaseGate";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Church workspace | NeighborWalk", robots: { index: false, follow: false } };
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <><Suspense fallback={<main className="auth-shell"><p role="status">Opening your church workspace…</p></main>}><NeighborWalkRoot /></Suspense>{children}</>;
}
