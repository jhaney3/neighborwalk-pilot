import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicPageContent } from "../components/PublicSite";

describe("public iOS information", () => {
  it("explains permissions, providers and the pending deletion process", () => {
    const html = renderToStaticMarkup(PublicPageContent({ page: "privacy" }));
    for (const text of ["iOS permissions", "Apple Push Notification", "private relay", "background location", "30 days", "Before public release", "backups"])
      expect(html).toContain(text);
  });
  it("gives a deletion path without claiming a request has erased data", () => {
    const html = renderToStaticMarkup(PublicPageContent({ page: "help" }));
    for (const text of ["Settings → Delete account", "same Apple account", "request was recorded", "does not mean deletion has finished", "never send your password"])
      expect(html).toContain(text);
  });
});
