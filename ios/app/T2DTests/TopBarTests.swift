import XCTest
import CoreText
@testable import T2D

// числа — из host/ui-top.js:11-38; W = 390, top = 47 (safe area iPhone с вырезом)
final class TopBarTests: XCTestCase {
  let bar = TopBar(W: 390, top: 47)
  let y: CGFloat = 67   // top + 20
  let tw: CGFloat = 50  // заголовок в вебе не шире tmax = vol.x − 17 − 30 − 46 = 59

  override class func setUp() {   // шрифты бандла тестов (как в DrawTests)
    let urls = Bundle(for: TopBarTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  func testPositions() {
    XCTAssertEqual(bar.pos(.clr).x, 363); XCTAssertEqual(bar.pos(.clr).y, 67)
    XCTAssertEqual(bar.pos(.undo).x, 324)
    XCTAssertEqual(bar.pos(.dice).x, 285)
    XCTAssertEqual(bar.pos(.rev).x, 240)
    XCTAssertEqual(bar.pos(.scl).x, 194)
    XCTAssertEqual(bar.pos(.vol).x, 152)
    let b = bar.pos(.back)
    XCTAssertEqual(b.x, 26); XCTAssertEqual(b.y, 67); XCTAssertEqual(b.r, 13)
  }

  func testRadii() {
    XCTAssertEqual(bar.pos(.scl).r, 20)
    XCTAssertEqual(bar.pos(.rev).r, 20)
    XCTAssertEqual(bar.pos(.vol).r, 17)
    for k in [Btn.clr, .undo, .dice] { XCTAssertEqual(bar.pos(k).r, 17) }
  }

  func testHitCentres() {
    for k in Btn.allCases {
      let p = bar.pos(k)
      XCTAssertEqual(bar.hit(p.x, p.y, titleW: tw), .btn(k), "\(k)")
    }
  }

  func testHitRadiiBoundaries() {
    let c = bar.pos(.clr), s = bar.pos(.scl), v = bar.pos(.vol), b = bar.pos(.back)
    XCTAssertEqual(bar.hit(c.x, c.y + 20.9, titleW: tw), .btn(.clr))   // CLR_R + 4 = 21
    XCTAssertNil(bar.hit(c.x, c.y + 21.1, titleW: tw))
    XCTAssertEqual(bar.hit(s.x, s.y + 25.9, titleW: tw), .btn(.scl))   // BTN_R + 6 = 26
    XCTAssertEqual(bar.hit(v.x - 20.9, v.y, titleW: tw), .btn(.vol))
    XCTAssertEqual(bar.hit(b.x, b.y - 22.9, titleW: tw), .btn(.back))      // r + 10 = 23
  }

  func testHitMisses() {
    XCTAssertNil(bar.hit(120, y, titleW: tw))      // между заголовком и громкостью
    XCTAssertNil(bar.hit(195, 47 + 60, titleW: tw))   // под строкой
    XCTAssertNil(bar.hit(200, 300, titleW: tw))
  }

  func testTitleHit() {
    XCTAssertEqual(bar.hit(80, y, titleW: tw), .title)
    XCTAssertEqual(bar.hit(46 + 50 + 9, y, titleW: tw), .title)       // до TITLE_X + titleW + 10
    XCTAssertNil(bar.hit(46 + 50 + 11, 47 + 37, titleW: tw))
    XCTAssertEqual(bar.hit(80, 47 + 37.9, titleW: tw), .title)        // y < top + 38
    XCTAssertNil(bar.hit(80, 47 + 38.1, titleW: tw))
  }

  func testTitleLosesToBackOverlap() {
    // стрелка проверяется раньше заголовка (headHit): x = 46 попадает в круг стрелки (26 + 23 = 49)
    XCTAssertEqual(bar.hit(46, y, titleW: tw), .btn(.back))
  }

  func testSclPick() {
    let L = bar.sclList
    XCTAssertEqual(L.rows, 7)
    XCTAssertEqual(L.top, 107)           // b.y + 40
    XCTAssertEqual(L.bx, 390 - 12 - 88 - 150)
    XCTAssertEqual(L.rx, L.bx + 158)
    let lx = L.bx + 30
    XCTAssertEqual(bar.sclPick(lx, L.top + 23), .off)
    XCTAssertEqual(bar.sclPick(lx, L.top + 46 + 23), .scale(0))
    XCTAssertEqual(bar.sclPick(lx, L.top + 46 * 6 + 23), .scale(5))
    XCTAssertEqual(bar.sclPick(lx, L.top + 46 * 7 + 40), .scale(5))   // ниже — зажимается по строкам
    XCTAssertEqual(bar.sclPick(L.rx + 20, L.top + 1), .root(0))
    XCTAssertEqual(bar.sclPick(L.rx + 40 + 20, L.top + 1), .root(6))   // вторая колонка, первый ряд
    XCTAssertEqual(bar.sclPick(L.rx + 40 + 20, L.top + L.ch * 5 + 1), .root(11))
    XCTAssertEqual(bar.sclPick(L.rx - 1, L.top + 23), .outside)        // щель между списком и тониками
    XCTAssertEqual(bar.sclPick(lx, 107 - 1), .outside)                 // выше b.y + 40
    XCTAssertEqual(bar.sclPick(10, 200), .outside)
  }

  func testDrawSmoke() {
    let c = CGContext(data: nil, width: 390, height: 300, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let d = Draw(g: c, W: 390, H: 300)
    var s = TopBar.State(title: "Firmamentum", vol: 0.5, volHeld: true, scl: Scl(on: true, idx: 1, root: 3),
                        sclOpen: true, canUndo: true, fxArc: nil, fxHeld: false, diceAt: -1e9)
    XCTAssertGreaterThan(bar.draw(d, s, now: 1000), 0)
    s.volHeld = false; s.sclOpen = false
    bar.draw(d, s, now: 1000)
  }

  func testFxArcPixel() {
    func px(_ arc: Double?) -> Int {
      let c = CGContext(data: nil, width: 390, height: 300, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      c.translateBy(x: 0, y: 300); c.scaleBy(x: 1, y: -1)
      let d = Draw(g: c, W: 390, H: 300)
      let s = TopBar.State(title: "x", vol: 0.5, volHeld: false, scl: Scl(on: false, idx: 0, root: 0), sclOpen: false,
                           canUndo: false, fxArc: arc, fxHeld: false, diceAt: -1e9)
      bar.draw(d, s, now: 0)
      let r = bar.pos(.rev), p = c.data!.assumingMemoryBound(to: UInt8.self)
      return Int(p[Int(r.y) * c.bytesPerRow + Int(r.x + TopBar.btnR + 5) * 4])   // 90° дуги; фон — чёрный, дуга — светлая
    }
    XCTAssertGreaterThan(px(0.5), 200)
    XCTAssertLessThan(px(nil), 20)
  }
}
