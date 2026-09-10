import { Suspense } from "react";
import { NeighborWalkRoot } from "../../components/SupabaseGate";
export const metadata = { title: "Sign in | NeighborWalk", robots: { index: false, follow: false } };
export default function Login() { return <Suspense fallback={<p>Preparing sign-in…</p>}><NeighborWalkRoot /></Suspense>; }
