import { Suspense } from "react";
import { NeighborWalkRoot } from "../../components/SupabaseGate";
export const metadata = { title: "Church invitation | SendMe", robots: { index: false, follow: false } };
export default function Invitation() {
  return <Suspense fallback={<p>Opening your invitation…</p>}><NeighborWalkRoot /></Suspense>;
}
