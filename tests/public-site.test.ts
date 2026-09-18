import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "../app/sitemap";
import { HomeContent, PublicPageContent, PublicShell, publicPages, type PublicPage } from "../components/PublicSite";

const renderPage = (page: PublicPage) => renderToStaticMarkup(PublicPageContent({ page }));

afterEach(() => vi.unstubAllEnvs());

describe("public website route inventory", () => {
  it("publishes every public content page in the sitemap", () => {
    const paths = sitemap().map(({ url }) => new URL(url).pathname);
    expect(paths).toEqual(["/", ...Object.keys(publicPages).map((page) => `/${page}`)]);
    expect(paths).toContain("/privacy");
    expect(paths).toContain("/terms");
  });
});

describe("public website simplicity", () => {
  it("makes the demo the primary action and states the core rhythm plainly", () => {
    const home = renderToStaticMarkup(PublicShell({ children: HomeContent() }));

    expect(home).toContain("Plan a walk.");
    expect(home).toContain("Meet your neighbors.");
    expect(home).toContain("Remember to follow up.");
    expect(home).toContain('<a class="site-button primary site-header-demo" href="/demo">');
    expect(home).toContain("Explore fictional sample data without an account.");
    expect(home).toContain("Needs follow-up");
    expect(home).toContain("All people");
    expect(home).toContain("Name not provided");
  });

  it("explains the leader and volunteer paths without hiding optional choices", () => {
    const howItWorks = renderPage("how-it-works");

    for (const label of ["When", "Where", "Who", "Review", "Home", "Walks", "People", "More"]) {
      expect(howItWorks).toContain(label);
    }
    expect(howItWorks).toContain("persistent mapped neighborhood zone");
    expect(howItWorks).toContain("smaller targets for that night");
    expect(howItWorks).toContain("one person or one reusable team");
    expect(howItWorks).toContain("new draft with preparation only");
    expect(howItWorks).toContain("never copies nightly targets, assignments or encounters");
    expect(howItWorks).not.toContain("use an address list or mapped area");
    expect(howItWorks).not.toContain("preparation and assignments");
    expect(howItWorks).toContain("starts on the map");
    expect(howItWorks).toContain("List");
    expect(howItWorks).toContain("conversation guide is optional");
    expect(howItWorks).toContain("short, factual encounter");
    expect(howItWorks).toContain("not shared a name or address");
    expect(howItWorks).toContain("Saving on the device is not the same as sharing");
  });

  it("uses the current app navigation in help while retaining safety guidance", () => {
    vi.stubEnv("NEIGHBORWALK_SUPPORT_EMAIL", "");
    const help = renderPage("help");

    for (const label of ["Home", "Walks", "People", "More", "Needs follow-up", "All people", "Device status"]) {
      expect(help).toContain(label);
    }
    expect(help).not.toContain("Open Today");
    expect(help).not.toContain("Open Outreach");
    expect(help).toContain("do not send a full church export or private care notes");
    expect(help).toContain("New church enrollment remains closed");
  });

  it("keeps the pilot and policy limitations explicit", () => {
    vi.stubEnv("NEIGHBORWALK_OPERATOR_NAME", "");
    vi.stubEnv("NEIGHBORWALK_SUPPORT_EMAIL", "");
    vi.stubEnv("NEIGHBORWALK_POLICIES_APPROVED", "false");
    vi.stubEnv("NEIGHBORWALK_PILOT_OPEN", "false");
    expect(renderPage("pricing")).toContain("No public subscription price has been finalized");
    expect(renderPage("trust")).toContain("We do not claim an independent security certification");
    expect(renderPage("privacy")).toContain("not a claim of legal compliance");
    expect(renderPage("terms")).toContain("Before public paid enrollment");
    expect(renderPage("pilot")).toContain("No inquiry is submitted from this page");
  });
});
