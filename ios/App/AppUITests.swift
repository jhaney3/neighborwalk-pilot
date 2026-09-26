import XCTest

final class AppUITests: XCTestCase {
    func testBundledWorkspaceNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "app.neighborwalk.ios")
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.buttons["Open"].exists { springboard.buttons["Open"].tap() }
        let sample = app.webViews.links["Explore sample workspace"].firstMatch
        let home = app.webViews.buttons["Open SendMe Home"].firstMatch
        if !home.waitForExistence(timeout: 2) {
            XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
            for _ in 0..<6 where !sample.isHittable { app.webViews.firstMatch.swipeUp() }
            XCTAssertTrue(sample.isHittable)
            sample.tap()
        }
        XCTAssertTrue(home.waitForExistence(timeout: 15))
        let homeShot = XCTAttachment(screenshot: app.screenshot())
        homeShot.name = "iPhone Home"
        homeShot.lifetime = .keepAlways
        add(homeShot)
        app.webViews.buttons["Walks"].firstMatch.tap()
        XCTAssertTrue(app.webViews.buttons["Plan a walk"].firstMatch.waitForExistence(timeout: 5))
        app.webViews.buttons["More"].firstMatch.tap()
        XCTAssertTrue(app.webViews.buttons["Settings & device"].firstMatch.waitForExistence(timeout: 5))
        app.webViews.buttons["Settings & device"].firstMatch.tap()
        XCTAssertTrue(app.webViews.buttons["Save church profile"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.webViews.buttons["Install app"].exists)
        app.webViews.buttons["Home"].firstMatch.tap()
        XCTAssertTrue(app.webViews.buttons["Plan a walk"].firstMatch.waitForExistence(timeout: 5))

        // Regression: closing Options must not leave an invisible tap blocker.
        app.webViews.buttons["Walks"].firstMatch.tap()
        let details = app.webViews.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "View details for ")).firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 5))
        details.tap()
        let options = app.webViews.descendants(matching: .any).matching(identifier: "Options").firstMatch
        XCTAssertTrue(options.waitForExistence(timeout: 5))
        options.tap()
        let backdrop = app.webViews.buttons["Close options"].firstMatch
        XCTAssertTrue(backdrop.waitForExistence(timeout: 5))
        backdrop.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()
        XCTAssertFalse(backdrop.exists)
        let invitations = app.webViews.buttons["Manage invitations"].firstMatch
        reveal(invitations, in: app)
        invitations.tap()
        XCTAssertTrue(app.webViews.buttons["Save invitations"].firstMatch.waitForExistence(timeout: 5))
        let invitationsShot = XCTAttachment(screenshot: app.screenshot())
        invitationsShot.name = "iPhone Invitations sheet"
        invitationsShot.lifetime = .keepAlways
        add(invitationsShot)
        app.webViews.buttons["Close dialog"].firstMatch.tap()
        let crews = app.webViews.buttons["Manage crews"].firstMatch
        reveal(crews, in: app)
        crews.tap()
        XCTAssertTrue(app.webViews.buttons["Close dialog"].firstMatch.waitForExistence(timeout: 5))
        let crewsShot = XCTAttachment(screenshot: app.screenshot())
        crewsShot.name = "iPhone Crews sheet"
        crewsShot.lifetime = .keepAlways
        add(crewsShot)
        app.webViews.buttons["Close dialog"].firstMatch.tap()
        reveal(invitations, in: app)
        invitations.tap()
        XCTAssertTrue(app.webViews.buttons["Save invitations"].firstMatch.waitForExistence(timeout: 5))
        app.webViews.buttons["Close dialog"].firstMatch.tap()
    }

    private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
        let web = app.webViews.firstMatch
        for _ in 0..<12 where !element.isHittable {
            let upward = element.frame.midY >= web.frame.minY + 160
            web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: upward ? 0.75 : 0.45)).press(forDuration: 0.05, thenDragTo: web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: upward ? 0.45 : 0.75)))
        }
        XCTAssertTrue(element.isHittable)
    }
}
