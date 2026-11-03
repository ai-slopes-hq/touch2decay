import XCTest
@testable import T2D

private final class RecD: Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true }
}

// картинка мира: пластина, клетки, названия нот, созвездия, вспышка (view.js:47-58, 366-431, 455-458)
final class CymaticaDrawTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: CymaticaDrawTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  private var mirrorBuf: [Double] = []
  private lazy var view = CymaticaView(core: RecD(), readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, seed: { 7 })
  private let size = CGSize(width: 390, height: 844)
  private let bg: RGB = (0, 0, 0)

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    mirrorBuf = mirror()
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало с умолчаниями; voices — (hz, level) до четырёх
  private func mirror(voices: [(Double, Double)] = []) -> [Double] {
    var b = [Double](repeating: 0, count: Cym.mirrorN)
    b[32] = 110
    for (k, v) in [2.0 / 7, 0.5, 0.5, 0.25, 0.15, 0.75, 1].enumerated() { b[33 + k] = v }
    b[40] = 96; b[43] = 16; b[44] = 7
    for i in 0..<Cym.slots { b[45 + 4 * i + 2] = 1 }
    b[158] = 0.3; b[159] = 0.5
    b[162] = 1; b[163] = 0.3; b[165] = -1
    for (k, v) in voices.enumerated() { b[24 + 2 * k] = v.0; b[25 + 2 * k] = v.1 }
    return b
  }
  private func shot(_ draw: (NatPen, Draw) -> Void) -> CGImage {
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    return UIGraphicsImageRenderer(size: size, format: f).image { r in
      let p = NatPen(g: r.cgContext, inkC: view.theme.ink, papC: view.theme.paper)
      p.fill(bg, 1); p.fillRect(0, 0, Double(size.width), Double(size.height))
      let d = Draw(g: r.cgContext, W: size.width, H: size.height)
      d.setTheme(view.theme)
      draw(p, d)
    }.cgImage!
  }
  private func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect { CGRect(x: x - w / 2, y: y - h / 2, width: w, height: h) }
  private func cellXY(_ ring: Int, _ s: Int) -> (x: Double, y: Double) {
    let c = cymCellCenter(ring: ring, sector: s, n: view.scl.degPerOct), G = view.geo
    return (G.cx + c.x * G.r, G.cy + c.y * G.r)
  }

  func testGlowOf() {
    XCTAssertEqual(view.glowOf(0.5), 1, accuracy: 1e-9)
    XCTAssertEqual(view.glowOf(1e-5), 0, accuracy: 1e-9)
    XCTAssertEqual(view.glowOf(1e-3), 0.5, accuracy: 1e-9)
  }

  func testLitCells() {
    mirrorBuf = mirror(voices: [(110, 0.5)]); view.tick(now: 1.1, dt: 0.1)
    view.litCells()
    let c = cymCellOf(view.noteList.firstIndex(of: 12)!, b: view.base(), n: view.scl.degPerOct)!
    for k in 0..<36 { XCTAssertEqual(view.lit[k], k == c.ring * 12 + c.sector ? 1 : 0, accuracy: 1e-9, "k \(k)") }
    mirrorBuf = mirror(voices: [(2000, 0.5), (110, 0)]); view.tick(now: 1.2, dt: 0.1)
    view.litCells()
    XCTAssertTrue(view.lit.allSatisfy { $0 == 0 })
    mirrorBuf = mirror(voices: [(.nan, 0.5), (0, 0.5), (-5, 0.5)]); view.tick(now: 1.3, dt: 0.1)
    view.litCells()                                          // не падает
    XCTAssertTrue(view.lit.allSatisfy { $0 == 0 })
  }

  func testShowNotes() {
    XCTAssertFalse(view.showNotes(now: 5))
    view.labelUntil = 6
    XCTAssertTrue(view.showNotes(now: 5))
    view.labelUntil = 0
    let o = NSObject()
    view.fingers[ObjectIdentifier(o)] = CymFinger(kind: .mtick)
    XCTAssertTrue(view.showNotes(now: 5))
    view.fingers[ObjectIdentifier(o)] = CymFinger(kind: .play)
    XCTAssertFalse(view.showNotes(now: 5))
  }

  func testCellGlowPixels() {
    let (x, y) = cellXY(0, 0), r = box(x, y, 10, 10)
    let cold = shot { p, d in view.litCells(); view.drawCells(p, d, now: 5) }
    mirrorBuf = mirror(voices: [(110, 0.5)]); view.tick(now: 1.1, dt: 0.1)
    let hot = shot { p, d in view.litCells(); view.drawCells(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(hot, in: r, bg: bg), litPixels(cold, in: r, bg: bg))
  }

  func testNotesWhileShown() {
    let (x, y) = cellXY(1, 1), r = box(x, y, 16, 12)
    view.labelUntil = 0
    let off = shot { p, d in view.litCells(); view.drawCells(p, d, now: 5) }
    view.labelUntil = 6
    let on = shot { p, d in view.litCells(); view.drawCells(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(on, in: r, bg: bg), litPixels(off, in: r, bg: bg))
  }

  func testStarsFade() {
    view.state.stars = [(0, -0.5, 1), (0.5, 0, 1)]
    let G = view.geo, q = G.fromPlate(0.5, 0), r = box(q.x, q.y, 6, 6)
    let a = shot { p, d in view.drawStars(p, d, now: 2) }
    XCTAssertGreaterThan(litPixels(a, in: r, bg: bg), 0)
    let b = shot { p, d in view.drawStars(p, d, now: 6.5) }
    XCTAssertEqual(litPixels(b, in: r, bg: bg), 0)
  }

  func testPlateAndFlash() {
    let G = view.geo
    let a = shot { p, d in view.drawPlate(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(a, in: box(G.cx + G.r, G.cy, 6, 6), bg: bg), 0)   // край пластины
    let f = shot { p, d in view.flash(d, 100, 100, 1, now: 1.25) }
    XCTAssertGreaterThan(litPixels(f, in: box(100, 100, 40, 40), bg: bg), 0)
    let g = shot { p, d in view.flash(d, 100, 100, 1, now: 1.6) }
    XCTAssertEqual(litPixels(g, in: box(100, 100, 40, 40), bg: bg), 0)
  }

  // ---------- астролябия (view.js:459-580) ----------
  private func put(_ edit: (inout [Double]) -> Void) { edit(&mirrorBuf); view.tick(now: 1.0 + Double(tickN) * 0.1, dt: 0.1); tickN += 1 }
  private var tickN = 1

  func testLenHeldBrighter() {
    put { $0[43] = 8 }
    let G = view.geo, a = CymGeo.slotAng(0) + 7.5 * Double.pi * 2 / 16
    let r = box(G.cx + cos(a) * G.R2, G.cy + sin(a) * G.R2, 12, 12)
    let free = shot { p, d in view.drawAstro(p, d, now: 5) }
    view.fingers[ObjectIdentifier(view)] = CymFinger(kind: .len, ring: 0)
    let held = shot { p, d in view.drawAstro(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(held, in: r, bg: bg), litPixels(free, in: r, bg: bg))
  }

  func testChanceSmaller() {
    put { $0[45 + 12] = 1 }
    let G = view.geo, q = G.slotXY(3, G.R2), r = box(q.x, q.y, 10, 10)
    let full = shot { p, d in view.drawAstro(p, d, now: 5) }
    put { $0[45 + 12 + 2] = 0.3 }
    let part = shot { p, d in view.drawAstro(p, d, now: 5) }
    let hi: RGB = (80, 80, 80)                               // заливка длины (альфа 0.09) светит всю коробку: считаем только яркое
    XCTAssertLessThan(litPixels(part, in: r, bg: hi), litPixels(full, in: r, bg: hi))
  }

  func testHandsOnlyPlaying() {
    let G = view.geo, q = G.slotXY(0, (G.rMax + G.R2) / 2), r = box(q.x, q.y, 6, 6)
    view.state.lastStep = (0, 0, 5)
    let still = shot { p, d in view.drawAstro(p, d, now: 5) }
    put { $0[41] = 1 }
    view.state.lastStep = (0, 0, 5)
    let play = shot { p, d in view.drawAstro(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(play, in: r, bg: bg), litPixels(still, in: r, bg: bg))
  }

  func testPlayGlyph() {
    let G = view.geo
    let tri = box(G.playX + 1.5, G.ty - 2.33, 2, 2), corner = box(G.playX + 5, G.ty - 5, 2.5, 2.5)
    let still = shot { p, d in view.drawAstro(p, d, now: 5) }
    XCTAssertGreaterThan(litPixels(still, in: tri, bg: bg), 0)
    XCTAssertEqual(litPixels(still, in: corner, bg: bg), 0)
    put { $0[41] = 1 }
    let play = shot { p, d in view.drawAstro(p, d, now: 5) }
    XCTAssertEqual(litPixels(play, in: tri, bg: bg), 0)
    XCTAssertGreaterThan(litPixels(play, in: corner, bg: bg), 0)
  }

  func testStepRecCursors() {
    let G = view.geo, pr = G.slotXY(2, G.R2 - 12), pm = G.slotXY(5, G.R1 + 15)
    let off = shot { p, d in view.drawAstro(p, d, now: 5) }
    put { $0[166] = 1; $0[167] = 2; $0[168] = 5 }
    let on = shot { p, d in view.drawAstro(p, d, now: 5) }
    for q in [pr, pm] { XCTAssertGreaterThan(litPixels(on, in: box(q.x, q.y, 5, 5), bg: bg), litPixels(off, in: box(q.x, q.y, 5, 5), bg: bg)) }
  }

  func testDrawExtremes() {
    let moon: (inout [Double]) -> Void = { $0[157] = 1; $0[160] = 1; $0[161] = 7 }
    for (rl, ml) in [(1, 1), (16, 16)] {
      put { $0[43] = Double(rl); $0[44] = Double(ml); $0[162] = 4; $0[165] = 15; $0[166] = 1; $0[167] = 15; $0[168] = 15; moon(&$0) }
      let img = shot { p, d in view.litCells(); view.drawStars(p, d, now: 5); view.drawCells(p, d, now: 5); view.drawAstro(p, d, now: 5) }
      if ml == 16 {                                          // круг замкнут: свет на стыке у slotAng(−0.5)
        let G = view.geo, a = CymGeo.slotAng(0) - Double.pi / 16
        XCTAssertGreaterThan(litPixels(img, in: box(G.cx + cos(a) * G.R1, G.cy + sin(a) * G.R1, 6, 6), bg: bg), 0)
      }
    }
    put { $0[43] = 16; $0[44] = 7; $0[165] = 15; $0[24] = 2000; $0[25] = 0; $0[26] = 110; $0[27] = 0
      for i in 0..<16 { $0[45 + 4 * i] = 1; $0[45 + 4 * i + 2] = 0.05 }
      for k in 33..<40 { $0[k] = 0 } }
    _ = shot { p, d in view.litCells(); view.drawAstro(p, d, now: 5) }
    put { for k in 33..<40 { $0[k] = 1 }; $0[44] = 1000; $0[43] = -3; $0[162] = 0; $0[167] = 99; $0[168] = -4 }
    view.state.lastStep = (15, 15, 5)
    _ = shot { p, d in view.litCells(); view.drawAstro(p, d, now: 5) }
  }

  // ---------- кадр: курсор, подписи, резонатор, drawFrame ----------
  private func frame(_ now: Double, _ v: CymaticaView? = nil) -> CGImage {
    let w = v ?? view
    return shot { _, d in w.drawFrame(d, now: now) }
  }

  func testDrawPure() {
    let fresh = CymaticaView(core: RecD(), readMirror: { _ in 0 }, readHeard: { _ in 0 }, seed: { 7 })
    fresh.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    _ = frame(0.5, fresh)                                    // до первого тика не падает
    view.state.stars.append((x: 0.2, y: -0.3, t: 1.0))
    view.fingers[ObjectIdentifier(self)] = CymFinger(kind: .mark, i: 2)
    view.pair = CymPair(a: ObjectIdentifier(self), b: ObjectIdentifier(view), a0: 0, d0: 30, kind: nil, target: 2, f00: 110, fromSemi: 12, orig: [], mel: [], last: 0)
    _ = frame(1.5); _ = frame(1.6)
    XCTAssertEqual(view.state.stars.count, 1)
    XCTAssertEqual(view.fingers.count, 1)
    XCTAssertNotNil(view.pair)
    XCTAssertEqual(view.shownF0, 110, accuracy: 1e-9)
  }

  func testResonatorAnswer() {
    view.state.heard(.answer(semi: 12), mirror: view.mirror, list: view.noteList, now: 1)
    let G = (x: 390.0 - 18, y: 844.0 - 34 - 16), r = box(G.x, G.y, 20, 20)
    let a = litPixels(frame(1.2), in: r, bg: bg), b = litPixels(frame(3), in: r, bg: bg)
    XCTAssertGreaterThan(a, b)
    XCTAssertGreaterThan(a, 0)
  }

  func testLabelUsesBaseF0() {
    put { $0[157] = 1; $0[161] = 3; $0[32] = 110 }
    view.labelUntil = view.now + 1
    _ = frame(view.now)
    XCTAssertEqual(view.drawLabelText(now: view.now), "A2 · 110 Hz")
    XCTAssertNil(view.drawLabelText(now: view.labelUntil))
    XCTAssertNil(view.drawLabelText(now: view.labelUntil + 1))
  }

  func testCursorDrawn() {
    put { $0[165] = 15; $0[44] = 7 }                         // курсор 15 при mlen 7: i = 1
    let G = view.geo, p = G.slotXY(1, G.R1)
    let c = litPixels(frame(5), in: box(p.x, p.y, 40, 40), bg: bg)
    put { $0[165] = -1 }
    XCTAssertGreaterThan(c, litPixels(frame(5), in: box(p.x, p.y, 40, 40), bg: bg))
  }

  func testDrawWide() {
    view.layout(W: 1024, H: 1366, topY: 50, safeBot: 34)
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    let img = UIGraphicsImageRenderer(size: CGSize(width: 1024, height: 1366), format: f).image { r in
      let d = Draw(g: r.cgContext, W: 1024, H: 1366)
      d.setTheme(view.theme)
      view.drawFrame(d, now: 5)
    }.cgImage!
    XCTAssertGreaterThan(litPixels(img, in: box(1024 - 34, 1366 - 34, 6, 6), bg: bg), 0)
  }

  func testCymaticaOnMap() { XCTAssertEqual(Worlds.info(2)?.view, true) }
}
