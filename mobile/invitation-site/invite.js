(() => {
  const status = document.getElementById("status");
  const token = new URLSearchParams(location.hash.slice(1)).get("join");
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    status.textContent = "This invitation link is incomplete. Open the full message from your leader or ask for a new link.";
    return;
  }
  const link = new URL("/invite", location.origin);
  link.hash = "join=" + token;
  const open = document.getElementById("open");
  open.href = "neighborwalk://invite#join=" + token;
  open.hidden = false;
  const store = window.NEIGHBORWALK_APP_STORE_URL;
  if (typeof store === "string" && /^https:\/\/apps\.apple\.com\//.test(store)) {
    const install = document.getElementById("install");
    install.href = store;
    install.hidden = false;
  }
  const copy = document.getElementById("copy");
  copy.hidden = false;
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link.href); status.textContent = "Copied. Paste this invitation in SendMe after installing."; }
    catch { status.textContent = "Select your browser’s address bar and copy the complete invitation link."; }
  };
  status.textContent = "This invitation works once and expires after 7 days. Share it only with its intended recipient.";
})();
