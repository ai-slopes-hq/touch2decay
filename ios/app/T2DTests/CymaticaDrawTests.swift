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
}
