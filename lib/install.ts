type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

let pendingPrompt: InstallPrompt | null = null;

export function captureInstallPrompt(event: Event) {
  if (!("prompt" in event) || typeof event.prompt !== "function") return;
  event.preventDefault();
  pendingPrompt = event as InstallPrompt;
}

export async function requestAppInstall(): Promise<string> {
  const prompt = pendingPrompt;
  if (!prompt) return "On iPhone or iPad, open Safari → Share → Add to Home Screen. On Android or desktop, use the browser menu → Install app (when available). If already installed, open SendMe from your home screen.";
  pendingPrompt = null; // Browsers allow each captured prompt to be used once.
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === "accepted" ? "Installation accepted. Open SendMe from your home screen." : "Installation dismissed. You can keep using SendMe in your browser.";
  } catch {
    return "Installation is not available right now. Use your browser’s Add to Home Screen or Install app command.";
  }
}
