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

  // контекст как в UIKit: начало слева сверху; строка bitmap i — это y = i
  private func flipped(_ n: Int) -> CGContext {
    let c = ctx(n, n)
    c.translateBy(x: 0, y: CGFloat(n)); c.scaleBy(x: 1, y: -1)
    return c
  }
  private func rowsWithInk(_ c: CGContext, _ n: Int) -> [Int] {
    let p = c.data!.assumingMemoryBound(to: UInt8.self), bpr = c.bytesPerRow
    return (0..<n).filter { r in (0..<n).contains { p[r * bpr + $0 * 4 + 3] != 0 } }
  }

  func testTextInkAroundBaselineBand() {
    let n = 200
    let c = flipped(n)
    let d = Draw(g: c, W: CGFloat(n), H: CGFloat(n))
    d.text("Abc", 10, 100, 12, 1)
    d.reading { d.mapText("Xyz", 100, 100, 14, 1, align: .center) }
    XCTAssertEqual(d.face, .map)
    let rows = rowsWithInk(c, n)
    XCTAssertFalse(rows.isEmpty)
    XCTAssertTrue(rows.allSatisfy { (85...115).contains($0) }, "ink outside the band around y: \(rows.first!)...\(rows.last!)")
    XCTAssertTrue(rows.contains { (90...100).contains($0) } && rows.contains { (100...108).contains($0) })
  }

  func testSunGlyphDraws() {
    let n = 200
    let c = flipped(n)
    let d = Draw(g: c, W: CGFloat(n), H: CGFloat(n))
    d.sunGlyph(100, 100, -.pi / 2, 0, scale: 1, now: 0, col: (237, 237, 237), disc: UIColor.black)
    let rows = rowsWithInk(c, n)
    XCTAssertFalse(rows.isEmpty)
    XCTAssertTrue(rows.allSatisfy { (40...160).contains($0) })
  }

  // concordia: коробка закрашивает карту под собой, вспышка restart ярче покоя
  func testConcordiaDrawSmoke() {
    let W = 390, H = 844
    let b = Concordia.box(W: CGFloat(W), H: CGFloat(H), safeBot: 34, sunY: 400)
    func lit(_ k: CGFloat) -> Int {
      let c = flipped2(W, H), d = Draw(g: c, W: CGFloat(W), H: CGFloat(H))
      Concordia.draw(d, b, link: Link(), stable: true, restartK: k)
      let p = c.data!.assumingMemoryBound(to: UInt8.self)
      var n = 0
      for y in Int(b.y)..<Int(b.y + b.h) { for x in Int(b.x)..<Int(b.x + b.w) where p[y * c.bytesPerRow + x * 4 + 1] > 40 { n += 1 } }
      return n
    }
    XCTAssertGreaterThan(lit(0), 50, "рамка, подписи и кружки нарисованы")
    XCTAssertGreaterThan(lit(1), lit(0), "audio restarted ярче")
  }

  // кадр карты: рубашка рисуется, лучи звучащего слота — только при lv > 0
  func testMapDrawSmoke() {
    let W = 390, H = 844
    let f = MapGeo.field(W: CGFloat(W), H: CGFloat(H), top: 60, safeBot: 34)
    func frame(_ l: Float) -> CGContext {
      let c = flipped2(W, H)
      let d = Draw(g: c, W: CGFloat(W), H: CGFloat(H))
      var lv = [Float](repeating: 0, count: 16); lv[10] = l
      MapDraw.draw(d, nav: Nav(), field: f, lv: lv, snap: nil, now: 1)
      return c
    }
    func px(_ c: CGContext, _ x: Int, _ y: Int) -> [UInt8] {
      let p = c.data!.assumingMemoryBound(to: UInt8.self), o = y * c.bytesPerRow + x * 4
      return [p[o], p[o + 1], p[o + 2]]
    }
    let a = frame(0.1), b = frame(0)
    let back = f.rect(col: 0, row: 0)
    XCTAssertNotEqual(px(a, Int(back.midX), Int(back.midY)), [0, 0, 0])
    let w = Worlds.info(10)!, cell = f.rect(col: w.col, row: w.row)
    var diff = 0
    for y in Int(cell.minY)..<Int(cell.maxY) { for x in Int(cell.maxX) + 2...Int(cell.maxX) + 6 where px(a, x, y) != px(b, x, y) { diff += 1 } }
    XCTAssertGreaterThan(diff, 0, "лучей нет у края клетки")
  }
  private func flipped2(_ w: Int, _ h: Int) -> CGContext {
    let c = ctx(w, h)
    c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: 1, y: -1)
    return c
  }
}
