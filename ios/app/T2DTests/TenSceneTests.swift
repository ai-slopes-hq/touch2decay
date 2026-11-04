import XCTest
@testable import T2D

// кеш фона и орбит: звёзды, рамка, меридианы, край дыры, орбиты со щипком (app.js:1003-1062, 1658-1736)
final class TenSceneTests: XCTestCase {
  private let rig = TenRig()
  private var view: TenebraeView { rig.view }
  private let layers = TenLayers()

  func testScanOnce() {
    layers.update(view, dpr: 1, now: 1); layers.update(view, dpr: 1, now: 1.5)
    XCTAssertEqual(layers.scanBuilds, 1)
    XCTAssertEqual(layers.scan?.width, 390); XCTAssertEqual(layers.scan?.height, 844)
    XCTAssertFalse(layers.stars.isEmpty)
  }

  func testOrbitKey() {
    layers.update(view, dpr: 1, now: 1)
    XCTAssertEqual(layers.orbitBuilds, 1)
    layers.update(view, dpr: 1, now: 1.5)
    XCTAssertEqual(layers.orbitBuilds, 1)
    view.zoomT = 0.5; view.zoom = 0.5
    layers.update(view, dpr: 1, now: 1.6)
    XCTAssertEqual(layers.orbitBuilds, 2)
  }

  func testPinchThrottle() {
    layers.update(view, dpr: 1, now: 0)
    var z = 0.9, t = 0.0
    for _ in 0..<60 { t += 1.0 / 60; z -= 0.4 / 60; view.zoom = z; view.zoomT = z; layers.update(view, dpr: 1, now: t) }
    XCTAssertLessThanOrEqual(layers.orbitBuilds, 17)
    view.zoom = 0.5; view.zoomT = 0.5; layers.update(view, dpr: 1, now: t + 0.01)     // новый ключ в пределах 1/15 с — ещё грязно
    let n = layers.orbitBuilds
    layers.update(view, dpr: 1, now: t + 0.2)
    XCTAssertEqual(layers.orbitBuilds, n + 1, "после остановки — последний зум")
    layers.update(view, dpr: 1, now: t + 0.4)
    XCTAssertEqual(layers.orbitBuilds, n + 1)
  }

  func testResize() {
    layers.update(view, dpr: 1, now: 1)
    view.layout(W: 430, H: 932, topY: 103, safeBot: 34)
    layers.update(view, dpr: 1, now: 1.01)
    XCTAssertEqual(layers.scan?.width, 430); XCTAssertEqual(layers.scanBuilds, 2)
    XCTAssertEqual(layers.bg?.width, 430)
  }

  func testDprCap() {
    layers.update(view, dpr: 3, now: 1)
    XCTAssertEqual(layers.scan?.width, 780)
  }

  func testBgPixels() throws {
    layers.update(view, dpr: 1, now: 1)
    let bg = try XCTUnwrap(layers.bg), G = view.geo
    let mid = (G.top + G.bot) / 2
    XCTAssertGreaterThan(tenLit(bg, CGRect(x: 3, y: mid, width: 4, height: 1), over: 8), 0, "внешняя рамка (слева её гасит край дыры, поэтому порог ниже)")
    let r0 = view.fieldCols()[1].r0, c = cos(Double.pi / 4)
    XCTAssertGreaterThan(tenLit(bg, CGRect(x: r0 * c - 3, y: G.bot - r0 * c - 3, width: 6, height: 6), over: 12), 0, "орбита границы колонки")
    XCTAssertEqual(tenLit(bg, CGRect(x: 0, y: 0, width: 390, height: G.top - 10)), 0, "вне поля")
  }
}
