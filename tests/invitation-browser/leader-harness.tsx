// Browser-only test fixture; never imported by either application entry point.
import { createRoot } from "react-dom/client";
import { LeaderInvitations } from "../../components/LeaderInvitations";
const existing = document.getElementById("root");
if (existing) existing.hidden = true;
const host = document.createElement("main");
host.style.padding = "20px";
document.body.append(host);
createRoot(host).render(<LeaderInvitations onChanged={async () => true} />);
