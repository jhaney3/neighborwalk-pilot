import XCTest

final class AppUITests: XCTestCase {
    func testBundledWorkspaceNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "app.neighborwalk.ios")
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        if springboard.buttons["Open"].exists { springboard.buttons["Open"].tap() }
        let sample = app.webViews.links["Explore sample workspace"].firstMatch
        let home = app.webViews.buttons["Open NeighborWalk Home"].firstMatch
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
    }
}
