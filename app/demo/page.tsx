import { Suspense } from "react";
import { NeighborWalkApp } from "../NeighborWalkApp";
export const metadata = { title: "Sample workspace | NeighborWalk", robots: { index: false, follow: false } };
export default function Demo() { return <Suspense fallback={<main className="app-loading"><h1>Preparing the sample workspace</h1><span role="status" aria-live="polite">Loading fictional records…</span></main>}><NeighborWalkApp /></Suspense>; }
