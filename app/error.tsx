"use client";
import Link from "next/link";
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="app-loading"><h1>This screen could not finish loading.</h1><p>Do not clear browser storage. Work that was confirmed saved on this device remains in its recovery store; an unsaved form may need to be entered again.</p>{error.digest && <p>Reference: {error.digest}</p>}<button className="button primary" onClick={retry}>Try this screen again</button><Link href="/app/recovery">Open recovery</Link><Link href="/help">Get help</Link></main>;
}
