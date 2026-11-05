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
    XCTAssertEqual(bar.pos(.fx).x, 363); XCTAssertEqual(bar.pos(.fx).y, 67)
    XCTAssertEqual(bar.pos(.recycle).x, 322)
    XCTAssertEqual(bar.pos(.dice).x, 284)
    XCTAssertEqual(bar.pos(.undo).x, 246)
    XCTAssertEqual(bar.pos(.vol).x, 208)
    XCTAssertEqual(bar.pos(.play).x, 170)
    let b = bar.pos(.back)
    XCTAssertEqual(b.x, 26); XCTAssertEqual(b.y, 67); XCTAssertEqual(b.r, 13)
  }

  func testRadii() {
    XCTAssertEqual(bar.pos(.fx).r, 20)
    XCTAssertEqual(bar.pos(.vol).r, 17)
    for k in [Btn.recycle, .undo, .dice, .play] { XCTAssertEqual(bar.pos(k).r, 17) }
  }

  func testHitCentres() {
    for k in Btn.allCases {
      let p = bar.pos(k)
      XCTAssertEqual(bar.hit(p.x, p.y, titleW: tw), .btn(k), "\(k)")
    }
  }

  func testHitRadiiBoundaries() {
    let c = bar.pos(.recycle), s = bar.pos(.fx), v = bar.pos(.vol), b = bar.pos(.back)
    XCTAssertEqual(bar.hit(c.x, c.y + 20.9, titleW: tw), .btn(.recycle))   // CLR_R + 4 = 21
    XCTAssertNil(bar.hit(c.x, c.y + 21.1, titleW: tw))
    XCTAssertEqual(bar.hit(s.x, s.y + 25.9, titleW: tw), .btn(.fx))   // BTN_R + 6 = 26
    XCTAssertEqual(bar.hit(v.x, v.y + 20.9, titleW: tw), .btn(.vol))   // по вертикали: по бокам зона соседей
    XCTAssertEqual(bar.hit(b.x, b.y - 22.9, titleW: tw), .btn(.back))      // r + 10 = 23
  }

  func testHitMisses() {
    XCTAssertNil(bar.hit(125, y, titleW: tw))      // между заголовком и play
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
      let r = bar.pos(.fx), p = c.data!.assumingMemoryBound(to: UInt8.self)
      return Int(p[Int(r.y) * c.bytesPerRow + Int(r.x + TopBar.btnR + 5) * 4])   // 90° дуги; фон — чёрный, дуга — светлая
    }
    XCTAssertGreaterThan(px(0.5), 200)
    XCTAssertLessThan(px(nil), 20)
  }

  // красная яркость пикселя (x, y) кадра верхней строки: фон — чёрный, знаки — светлые
  private func pixel(_ x: CGFloat, _ y: CGFloat, back: Bool = false, dice: Bool = false, sclOpen: Bool = false) -> Int {
    let c = CGContext(data: nil, width: 390, height: 300, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: 300); c.scaleBy(x: 1, y: -1)
    let d = Draw(g: c, W: 390, H: 300)
    let s = TopBar.State(title: "x", vol: 0.5, volHeld: false, scl: Scl(on: false, idx: 0, root: 0), sclOpen: sclOpen,
                         canUndo: false, fxArc: nil, fxHeld: false, backHeld: back, diceHeld: dice, diceAt: -1e9)
    bar.draw(d, s, now: 0)
    return Int(c.data!.assumingMemoryBound(to: UInt8.self)[Int(y) * c.bytesPerRow + Int(x) * 4])
  }

  // стрелка назад — не приглушена (было ×0.3, пока карты не было): вершина знака светится ≈ ink(0.8)
  func testBackNotMuted() {
    let B = bar.pos(.back)
    XCTAssertGreaterThan(pixel(B.x - 3, B.y), 150)
    XCTAssertLessThan(pixel(B.x - 3, B.y, sclOpen: true), 100, "при открытом списке ладов — в тени, как заголовок")
  }

  // нажатая стрелка и кубик — ярче (ui-top.js:107-111, 128): кольцо 1 вместо 0.45
  func testBackHeldHighlight() {
    let B = bar.pos(.back), D = bar.pos(.dice)
    XCTAssertGreaterThan(pixel(B.x - 3, B.y, back: true), pixel(B.x - 3, B.y))
    XCTAssertGreaterThan(pixel(B.x + B.r, B.y, back: true), pixel(B.x + B.r, B.y) + 40, "кольцо стрелки")
    XCTAssertGreaterThan(pixel(D.x + TopBar.clrR, D.y, dice: true), pixel(D.x + TopBar.clrR, D.y) + 40, "кольцо кубика")
  }

  func testButtonOrderRightToLeft() {
    let xs = [Btn.fx, .recycle, .dice, .undo, .vol, .play, .back].map { bar.pos($0).x }
    XCTAssertEqual(xs, xs.sorted(by: >))
  }

  func testDisabledButtonHasNoHit() {
    let u = bar.pos(.undo)
    XCTAssertEqual(bar.hit(u.x, u.y, titleW: tw), .btn(.undo))
    XCTAssertNil(bar.hit(u.x, u.y, titleW: tw, enabled: Set(Btn.allCases).subtracting([.undo])))
  }

  func testNearestButtonWinsInOverlap() {
    let d = bar.pos(.dice), r = bar.pos(.recycle)
    XCTAssertEqual(bar.hit(d.x + 15, d.y, titleW: tw), .btn(.dice))      // у dice
    XCTAssertEqual(bar.hit(r.x - 15, r.y, titleW: tw), .btn(.recycle))   // у recycle
  }

  func testSixButtonsDoNotOverlapAtW320() {
    let b = TopBar(W: 320, top: 47)
    let order = [Btn.fx, .recycle, .dice, .undo, .vol, .play]
    for (a, c) in zip(order, order.dropFirst()) {
      let p = b.pos(a), q = b.pos(c)
      XCTAssertGreaterThanOrEqual(hypot(p.x - q.x, p.y - q.y), p.r + q.r + 2, "\(a) / \(c)")
    }
    let (w, _, _) = TopBar.fit("Tria corpora", max: b.titleMax)
    XCTAssertLessThanOrEqual(TopBar.titleX + w, b.pos(.play).x - b.pos(.play).r - 4 + 0.5)
  }

  private func drawn(playing: Bool) -> Int {
    let c = CGContext(data: nil, width: 390, height: 300, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: 300); c.scaleBy(x: 1, y: -1)
    var s = TopBar.State(title: "x", vol: 0.5, volHeld: false, scl: Scl(on: false, idx: 0, root: 0), sclOpen: false,
                         canUndo: false, fxArc: nil, fxHeld: false, diceAt: -1e9)
    s.playing = playing
    bar.draw(Draw(g: c, W: 390, H: 300), s, now: 0)
    let p = bar.pos(.play), px = c.data!.assumingMemoryBound(to: UInt8.self)
    return Int(px[Int(p.y) * c.bytesPerRow + Int(p.x) * 4])   // центр: у pause — зазор между палочками, у play — треугольник
  }

  func testPlayIconSwitches() {
    XCTAssertNotEqual(drawn(playing: true), drawn(playing: false))
  }
}
