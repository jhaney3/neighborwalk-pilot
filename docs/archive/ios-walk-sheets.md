# Walk invitation and crew sheets

> Historical implementation and test note. For current iOS release status, see the [iOS release guide](../ios-release.md).

Claude's Contacts-style invited roster and grouped selection lists are preserved. The summary retains zero counts for “here” and “going”; only the declined attendance text uses red. Manage invitations and Manage crews have a minimum 44-point button height.

The Options control is React-managed. Its backdrop exists only while the menu is open; it does not install document-level pointer listeners. Keyboard users can open with Arrow Down, navigate menu items, and dismiss with Escape or Tab. Dismissal returns focus to Options. The shared dialog restores focus to its opener on close.

Verification commands:

- `npm run test:mobile` covers Chromium and WebKit projects, including repeated Options → dismiss → Invitations → close → Crews → close interactions and small-screen overflow checks. WebKit needs its host libraries; they are unavailable on the current Linux machine.
- `npm run ios:sync` refreshes the bundled app before native checks.
- Xcode's App scheme includes an XCUITest of that interaction in the installed app. Use a separate simulator and DerivedData directory when another person or agent is building the same project.

The XCUITest selects Options across accessibility element types: WKWebView exposes the menu trigger as an `Other` element, even though its HTML is a button. A failed `buttons["Options"]` lookup alone is not evidence that the app's control is missing.

Tests use the explicitly separate fictional sample workspace. They open and close the sheets without saving roster, crew, or walk-status changes.
