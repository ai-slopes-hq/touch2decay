import XCTest
@testable import T2D

final class NatArtTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: NatArtTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  let box = CGRect(x: 60, y: 60, width: 80, height: 80)

  func testFlowerForms() {
    let imgs = (0..<5).map { w in natCanvas { NatArt.flower($0, 100, 100, wave: w, 20, 1) } }
    for (w, i) in imgs.enumerated() {
      XCTAssertGreaterThan(inkPixels(i, in: CGRect(x: 80, y: 80, width: 40, height: 40)), 0, "wave \(w)")
    }
    for a in 0..<5 { for b in (a + 1)..<5 { XCTAssertNotEqual(natBytes(imgs[a]), natBytes(imgs[b]), "\(a) vs \(b)") } }
  }

  func testRainDeterministic() {
    func r(_ t: Double) -> Data { natBytes(natCanvas { NatArt.rain($0, 100, 10, 160, 190, 0.8, t, 1) }) }
    XCTAssertEqual(r(1000), r(1000))
    XCTAssertNotEqual(r(1000), r(1300))
  }

  func testShapesDraw() {
    func ink(_ name: String, _ draw: @escaping (NatPen) -> Void) {
      XCTAssertGreaterThan(inkPixels(natCanvas(draw), in: box), 0, name)
    }
    ink("leaf") { NatArt.leaf($0, 100, 110, 0.4, 3, 1) }
    ink("leaf nofill") { NatArt.leaf($0, 100, 110, 0.4, 3, 1, fill: false) }
    ink("leafPath") { NatArt.leafPath($0, 100, 110, 0.4, 3) }
    ink("cloud0") { NatArt.cloud($0, 100, 100, 1, 1) }
    ink("cloud1") { NatArt.cloud($0, 100, 100, 1, 1, heavy: 1) }
    ink("lily locked") { NatArt.lily($0, 100, 100, 1, wave: 2, open: 0.5, 1, locked: true) }
    ink("lily free") { NatArt.lily($0, 100, 100, 1, wave: 2, open: 0.5, 1, locked: false) }
    ink("lily chance") { NatArt.lily($0, 100, 100, 1, wave: 3, open: 0.5, 1, locked: false, chance: 0.5) }
    ink("boat") { NatArt.boatShape($0, 100, 100, 2, 0.1, paused: false) }
    ink("boat paused") { NatArt.boatShape($0, 100, 100, 2, 0.1, paused: true) }
    ink("duck") { NatArt.duck($0, NatDuck(x: 100, y: 100, s: 20, dir: 1), nod: 0.3) }
    ink("flyer") { NatArt.flyer($0, 90, 100, 20, 1, 0.5) }
    let G = NatGeo(W: 200, H: 200, topY: 0, safeBot: 0)
    let pd = G.pond()
    let D = (a: NatDuck(x: 0, y: 0, s: 12, dir: 1), r: NatDuck(x: 0, y: 0, s: 26, dir: -1))
    let img = natCanvas { NatArt.ducklings($0, G, 1000, D) }
    XCTAssertGreaterThan(inkPixels(img, in: CGRect(x: pd.x - pd.rx, y: pd.y - pd.ry, width: pd.rx * 2, height: pd.ry * 2 + 10)), 0, "ducklings")
  }

  func testCloudHeavy() {
    let a = inkPixels(natCanvas { NatArt.cloud($0, 100, 100, 1, 1, heavy: 0) }, in: box)
    let b = inkPixels(natCanvas { NatArt.cloud($0, 100, 100, 1, 1, heavy: 1) }, in: box)
    XCTAssertGreaterThan(b, a)
  }
}
