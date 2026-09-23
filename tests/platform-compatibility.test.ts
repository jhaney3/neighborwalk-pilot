import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "../lib/platform";

afterEach(() => vi.unstubAllGlobals());

describe("iOS 15 platform compatibility", () => {
  it("creates an RFC 4122 UUID when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.forEach((_, index) => { bytes[index] = index; });
        return bytes;
      },
    });
    const value = randomUuid();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
