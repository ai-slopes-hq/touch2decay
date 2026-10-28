import XCTest
import CoreText

// Тесты без TEST_HOST: шрифты лежат в бандле тестов и регистрируются здесь же (UIAppFonts работает только в приложении)
final class DrawTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: DrawTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  private func ctx(_ w: Int, _ h: Int) -> CGContext {
    CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  }

  func testFontsRegistered() {
    for n in ["IM_FELL_English_Roman", "IM_FELL_English_Italic", "EBGaramond-Regular", "EBGaramond-Italic"] {
      XCTAssertNotNil(UIFont(name: n, size: 12), n)
    }
  }

  func testGlowSpriteBuiltOnce() {
    let d = Draw(g: ctx(10, 10), W: 10, H: 10)
    let a = Draw.glowSprite
    d.glowAt(5, 5, 4, 1); d.glowAt(5, 5, 4, 0.5)
    XCTAssertTrue(a === Draw.glowSprite)
    XCTAssertEqual(a.width, 128)
  }

  func testGlowSkipsFaint() {
    let c = ctx(1, 1)
    let d = Draw(g: c, W: 1, H: 1)
    d.glowAt(0.5, 0.5, 4, 0.003)
    let p = c.data!.assumingMemoryBound(to: UInt8.self)
    XCTAssertEqual([p[0], p[1], p[2], p[3]], [0, 0, 0, 0])
    d.glowAt(0.5, 0.5, 4, 1)   // контроль: заметное свечение рисует
    XCTAssertGreaterThan(p[3], 0)
  }

  func testScaleCapped() {
    XCTAssertEqual(Draw.scale, min(UIScreen.main.scale, 2))
  }

  func testTextAndSunDrawSomething() {
    let c = ctx(200, 200)
    let d = Draw(g: c, W: 200, H: 200)
    d.text("Abc", 10, 100, 12, 1)
    d.reading { d.mapText("Xyz", 100, 50, 14, 1, align: .center) }
    XCTAssertEqual(d.face, .map)
    d.sunGlyph(100, 100, -.pi / 2, 0, scale: 1, now: 0, col: (237, 237, 237), disc: UIColor.black)
    let p = c.data!.assumingMemoryBound(to: UInt8.self)
    XCTAssertTrue((0..<200 * 200 * 4).contains { p[$0] != 0 })
  }
}
