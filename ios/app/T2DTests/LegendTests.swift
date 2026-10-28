import XCTest
import CoreText

// легенда — порт host/legend.js; шрифты — как в DrawTests
final class LegendTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: LegendTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  private func ctx(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  }
  private func inked(_ c: CGContext) -> Bool {
    let n = c.width * c.height * 4, p = c.data!.assumingMemoryBound(to: UInt8.self)
    for i in stride(from: 3, to: n, by: 4) where p[i] > 0 { return true }
    return false
  }
  private func rows(_ n: Int) -> [LegendRow] {
    (0..<n).map { LegendRow(glyph: .tap, gesture: "tap water · tap a lily", does: "plant a lily · remove it \($0)") }
  }

  func testGeo() {
    let g = Legend.geo(W: 390, H: 844, top: 47, safeBot: 34, rows: 5)
    XCTAssertEqual(g.x, 14)
    XCTAssertEqual(g.w, 362)
    XCTAssertEqual(g.top, 97)
    XCTAssertTrue((34...50).contains(g.rh), "rh \(g.rh)")
    XCTAssertEqual(g.h, 82 + 5 * g.rh + 30, accuracy: 0.001)
  }

  func testGeoClampsRowHeight() {
    XCTAssertEqual(Legend.geo(W: 390, H: 844, top: 47, safeBot: 34, rows: 30).rh, 34)
    XCTAssertEqual(Legend.geo(W: 390, H: 844, top: 47, safeBot: 34, rows: 1).rh, 50)
    XCTAssertEqual(Legend.geo(W: 390, H: 844, top: 47, safeBot: 34, rows: 0).rh, 50)   // пустая легенда не делит на ноль
  }

  func testEveryGlyphDraws() {
    for gl in [Glyph.tap, .double, .hold, .drag, .up, .draw, .throw, .shake, .two, .pinch, .twist] {
      let c = ctx(60, 60)
      Legend.glyph(Draw(g: c, W: 60, H: 60), gl, 30, 30)
      XCTAssertTrue(inked(c), "\(gl)")
    }
  }

  func testDrawOverlay() {
    let c = ctx(390, 844)
    Legend.draw(Draw(g: c, W: 390, H: 844), title: "L E G E N D A", rows: rows(5), W: 390, H: 844, top: 47, safeBot: 34)
    XCTAssertTrue(inked(c))
  }

  func testFitTextShrinksToWidth() {
    let s = "throw the skiff at the ducks · very long gesture description"
    let full = Legend.width(s, 15), fit = Legend.fitSize(s, 15, maxW: 120)
    XCTAssertGreaterThan(full, 120)
    XCTAssertLessThan(fit, 15)
    XCTAssertGreaterThanOrEqual(fit, 9)
    XCTAssertEqual(Legend.fitSize("tap", 15, maxW: 300), 15)
  }
}
