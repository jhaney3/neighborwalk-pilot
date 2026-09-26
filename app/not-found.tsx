import Link from "next/link";
export default function NotFound() {
  return <main className="app-loading"><h1>That page isn’t here.</h1><p>The link may be old or incomplete. Church records also require the right signed-in account.</p><Link className="button primary" href="/app/today">Open your workspace</Link><Link href="/">SendMe website</Link></main>;
}
