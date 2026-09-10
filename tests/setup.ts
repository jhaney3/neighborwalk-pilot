import { Socket } from "node:net";
import { beforeEach, vi } from "vitest";

function blockedNetwork(): never {
  throw new Error("Unit tests cannot access the network. Mock the request or use the isolated sandbox.");
}

// Cover both fetch/Undici and Node HTTP clients. Provider tests may replace fetch with fixtures.
vi.spyOn(Socket.prototype, "connect").mockImplementation(blockedNetwork);
beforeEach(() => {
  vi.stubGlobal("fetch", blockedNetwork);
});
