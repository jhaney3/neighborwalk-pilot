import { Suspense } from "react";
import { NeighborWalkApp } from "../NeighborWalkApp";
export const metadata = { title: "Sample workspace | NeighborWalk", robots: { index: false, follow: false } };
export default function Demo() { return <Suspense fallback={<p>Preparing the sample workspace…</p>}><NeighborWalkApp /></Suspense>; }
