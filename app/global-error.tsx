"use client";
export default function GlobalError({ retry }: { retry: () => void }) {
  return <html lang="en"><body style={{ margin: 0, padding: 40, fontFamily: "Arial, sans-serif", lineHeight: 1.6, background: "#faf9f4", color: "#19392e" }}><title>NeighborWalk needs to reload</title><main><h1>NeighborWalk could not open this screen.</h1><p>Keep browser storage intact. Reloading does not deliberately remove saved device records, but an unsaved form may need to be entered again.</p><button onClick={retry} style={{ minHeight: 44, padding: "10px 20px", fontSize: 16 }}>Try again</button><p>Contact your church leader if this continues. Do not send private care notes in an error report.</p></main></body></html>;
}
