import XCTest
@testable import T2D

private final class TSRec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// плашка планеты Tenebrae и панель LFO модели (app.js:542-569, 600-613, 681-727, 760-772, 797-819)
final class TenSheetTests: XCTestCase {
  private let rec = TSRec()
  private var mbuf: [Double] = []
  private lazy var view = TenebraeView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mbuf.count, b.count); b.replaceSubrange(0..<n, with: self.mbuf[0..<n]); return n
  }, readHeard: { _ in 0 }, readLevel: { 0 }, rng: { 0.5 })
  private let a = NSObject(), b = NSObject(), c = NSObject()

  override func setUp() {
    mbuf = mirror()
    view.layout(W: 390, H: 844, topY: 103, safeBot: 34)
    view.tick(now: 0.5, dt: 0.016)
    rec.acts.removeAll()
  }
  private func mirror(_ edit: (inout [Double]) -> Void = { _ in }) -> [Double] {
    var m = [Double](repeating: 0, count: Ten.mirrorN)
    m[0] = 6; m[3] = 0.3; m[4] = 3.5; m[5] = 0.3; m[6] = 0; m[7] = 0.2
    for i in 0..<6 { for k in 0..<8 { m[Ten.head + Ten.voiceN * i + 38 + 3 * k + 2] = -1 } }
    edit(&m)
    return m
  }
  private func put(_ m: inout [Double], _ i: Int, active: Bool = true) {
    let o = Ten.head + Ten.voiceN * i
    m[o] = active ? 1 : 0; m[o + 1] = active ? 1 : 0
    m[o + 4] = 0.4; m[o + 5] = 0.5; m[o + 6] = 0.35; m[o + 9] = 0.5; m[o + 15] = 1; m[o + 16] = 1
  }
  private func tick(_ t: Double) { view.tick(now: t, dt: 0.016) }
  private func fing(_ id: NSObject, _ x: Double, _ y: Double, t0: Double, x0: Double? = nil, y0: Double? = nil) -> Finger {
    Finger(id: ObjectIdentifier(id), x: x, y: y, x0: x0 ?? x, y0: y0 ?? y, t0: t0, moved: false, touchTime: t0)
  }
  private var log: [(kind: Int, i: Int, a: [Double], t: Double)] { rec.acts.filter { $0.kind != Act.sun } }
  private func geo(_ lfo: Bool = false) -> TenSheetGeo { TenSheetGeo(W: 390, H: 844, safeBot: 34, lfo: lfo) }

  // удержание планеты 0 → плашка; палец удержания поднят, журнал чист
  private func open() {
    mbuf = mirror { self.put(&$0, 0) }
    tick(1)
    let p = view.screenPos(0)
    view.down(fing(a, p.x, p.y, t0: 1))
    tick(1.5)
    view.up(fing(a, p.x, p.y, t0: 1))
    XCTAssertEqual(view.sheetVoice, 0)
    rec.acts.removeAll()
  }
  private let cutRow = 0
  private func rowMid(_ g: TenSheetGeo, _ i: Int) -> Double { g.rowY(i) + 20 }

  func testGeo() {
    let g = geo()
    XCTAssertEqual(g.bottom, 802); XCTAssertEqual(g.top, 460); XCTAssertEqual(g.waveY, 512)
    XCTAssertEqual(g.rowY(0), 560); XCTAssertEqual(g.rowY(1), 600)
    XCTAssertEqual(g.x, 16); XCTAssertEqual(g.w, 358); XCTAssertEqual(g.tx0, 86); XCTAssertEqual(g.tx1, 16 + 358 - 112)
    XCTAssertEqual(g.lfoX, 16 + 358 - 18)
    XCTAssertEqual(g.close, CGRect(x: 310, y: 472, width: 64, height: 30))
    XCTAssertEqual(g.pitch, CGRect(x: 234, y: 472, width: 66, height: 30))
    XCTAssertNil(g.panel)
    let l = geo(true)
    XCTAssertEqual(l.top, 264); XCTAssertNotNil(l.panel)
    XCTAssertEqual(l.panel?.shape.y, 802 - 196 + 30)
  }

  func testOpenClose() {
    open()
    XCTAssertFalse(view.cornerHit(0, 806))
    view.down(fing(b, 200, geo().top - 5, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.unkeep]); XCTAssertNil(view.sheetVoice)
    XCTAssertTrue(view.cornerHit(0, 806))
    view.up(fing(b, 200, geo().top - 5, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.unkeep], "в поле ничего не ушло")
  }

  func testCloseChip() {
    open()
    let g = geo()
    view.down(fing(b, g.close.midX, g.close.midY, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.unkeep]); XCTAssertNil(view.sheetVoice)
  }

  func testRowDrag() {
    open()
    let g = geo(), y = rowMid(g, cutRow)
    let n0 = tenNorm(Row.cut, view.voice(0).cut), dx = 0.1 * (g.tx1 - g.tx0)
    view.down(fing(b, g.tx0 + 50, y, t0: 2))
    XCTAssertTrue(log.isEmpty)
    view.move(fing(b, g.tx0 + 50 + dx, y, t0: 2, x0: g.tx0 + 50))
    XCTAssertEqual(log.count, 1); XCTAssertEqual(log[0].kind, Act.set); XCTAssertEqual(log[0].i, 0)
    XCTAssertEqual(log[0].a[0], 1); XCTAssertEqual(log[0].a[1], tenSetNorm(Row.cut, n0 + 0.1), accuracy: 1e-9)
    view.up(fing(b, g.tx0 + 50 + dx, y, t0: 2, x0: g.tx0 + 50))
    rec.acts.removeAll()
    tick(3.0)                                                // двойной тап: два быстрых касания в 0.32 с
    view.down(fing(c, g.tx0 + 50, y, t0: 3.0)); tick(3.05)
    view.up(fing(c, g.tx0 + 50, y, t0: 3.0)); tick(3.1)
    XCTAssertTrue(log.isEmpty)
    view.down(fing(c, g.tx0 + 50, y, t0: 3.1))
    XCTAssertEqual(log.map(\.kind), [Act.set]); XCTAssertEqual(log[0].a, [1, 0.68])
    view.move(fing(c, g.tx0 + 90, y, t0: 3.1, x0: g.tx0 + 50))
    XCTAssertEqual(log.count, 1, "после двойного тапа бегунок не тянет")
  }

  func testDoubleTapLate() {
    open()
    let g = geo(), y = rowMid(g, cutRow)
    tick(3.0)
    view.down(fing(c, g.tx0 + 50, y, t0: 3.0)); tick(3.05)
    view.up(fing(c, g.tx0 + 50, y, t0: 3.0)); tick(3.4)
    view.down(fing(c, g.tx0 + 50, y, t0: 3.4))
    XCTAssertTrue(log.isEmpty, "через 0.35 с — не двойной")
  }

  func testWaveStrip() {
    open()
    let g = geo()
    view.down(fing(b, g.x + 18 + (g.w - 36) / 2, g.waveY + 20, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.set]); XCTAssertEqual(log[0].a[0], 0); XCTAssertEqual(log[0].a[1], 0.5, accuracy: 1e-9)
    view.move(fing(b, 10_000, g.waveY + 20, t0: 2))
    XCTAssertEqual(log.last?.a[1], 1)
  }

  func testLfo() {
    open()
    let g = geo(), y = rowMid(g, cutRow)
    view.down(fing(b, g.tx1 + 30, y, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.setLfo]); XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [2, 0, 1.2, 0.35])
    XCTAssertEqual(view.sheetLfo, .cut)
    view.up(fing(b, g.tx1 + 30, y, t0: 2))
    rec.acts.removeAll()
    let l = geo(true), p = l.panel!
    let px = Double(p.x) + 200, py = Double(p.pad.y) + 40
    view.down(fing(c, px, py, t0: 3))
    XCTAssertEqual(log.count, 1); XCTAssertEqual(log[0].kind, Act.setLfo)
    XCTAssertEqual(log[0].a[0], 2); XCTAssertEqual(log[0].a[1], 0)
    XCTAssertEqual(log[0].a[2], Pad.rate(p, CGFloat(px)), accuracy: 1e-9)
    XCTAssertEqual(log[0].a[3], Pad.depth(p, CGFloat(py)), accuracy: 1e-9)
    // полоса форм меняет только morph
    rec.acts.removeAll()
    view.up(fing(c, px, py, t0: 3))
    rec.acts.removeAll()
    view.down(fing(c, Double(p.x) + 100, Double(p.shape.y) + 10, t0: 4))
    XCTAssertEqual(log[0].a[1], Pad.shapeT(p, CGFloat(p.x) + 100), accuracy: 1e-9)
    XCTAssertEqual(log[0].a[2], Pad.rate(p, CGFloat(px)), accuracy: 1e-9)
    view.up(fing(c, Double(p.x) + 100, Double(p.shape.y) + 10, t0: 4))
    rec.acts.removeAll()
    // глубину увели в ноль — на отпускании LFO снят
    let low = Double(Pad.depthY(p, 0.02))
    view.down(fing(c, px, low, t0: 5))
    rec.acts.removeAll()
    view.up(fing(c, px, low, t0: 5))
    XCTAssertEqual(log.map(\.kind), [Act.setLfo]); XCTAssertEqual(log[0].a, [2, 0, 0, -1])
    XCTAssertNil(view.voice(0).lfo[2])
  }

  func testLfoOffChipAndCollapse() {
    open()
    let g = geo(), y = rowMid(g, cutRow)
    view.down(fing(b, g.tx1 + 30, y, t0: 2)); view.up(fing(b, g.tx1 + 30, y, t0: 2))
    rec.acts.removeAll()
    let l = geo(true), p = l.panel!
    let ox = Double(p.x + p.w - 23), oy = Double(p.top + 6)
    view.down(fing(c, ox, oy, t0: 3))                        // off-чип
    XCTAssertEqual(log.map(\.kind), [Act.setLfo]); XCTAssertEqual(log[0].a, [2, 0, 0, -1])
    view.up(fing(c, ox, oy, t0: 3))
    rec.acts.removeAll()
    view.down(fing(c, l.tx1 + 30, rowMid(l, cutRow), t0: 4))  // «~» той же строки при открытой панели — свернуть
    XCTAssertTrue(log.isEmpty); XCTAssertNil(view.sheetLfo)
    view.up(fing(c, l.tx1 + 30, rowMid(l, cutRow), t0: 4))
    view.down(fing(c, g.tx1 + 30, y, t0: 5)); view.up(fing(c, g.tx1 + 30, y, t0: 5))
    XCTAssertNotNil(view.voice(0).lfo[2])
    view.down(fing(c, l.tx1 + 30, rowMid(l, cutRow), t0: 6)); view.up(fing(c, l.tx1 + 30, rowMid(l, cutRow), t0: 6))
    XCTAssertNil(view.sheetLfo); XCTAssertNotNil(view.voice(0).lfo[2], "LFO остаётся")
  }

  func testPitchChip() {
    open()
    let g = geo()
    view.down(fing(b, g.pitch.midX, g.pitch.midY, t0: 2))
    XCTAssertEqual(view.sheetLfo, .pitch)
    XCTAssertEqual(log.map(\.kind), [Act.setLfo]); XCTAssertEqual(log[0].a, [0, 0, 1.2, 0.35])
  }

  func testAmpRowHasNoLfo() {
    open()
    let g = geo()
    view.down(fing(b, g.tx1 + 30, rowMid(g, 5), t0: 2))
    XCTAssertNil(view.sheetLfo); XCTAssertTrue(log.isEmpty)
  }

  func testSheetClosesWhenGone() {
    open()
    mbuf = mirror { self.put(&$0, 0, active: false) }
    tick(2)
    XCTAssertEqual(log.map(\.kind), [Act.unkeep]); XCTAssertNil(view.sheetVoice)
    let g = geo()                                            // плашки нет: касание там же — поле, не плашка
    rec.acts.removeAll()
    view.down(fing(b, g.tx1 + 30, rowMid(g, cutRow), t0: 3))
    XCTAssertNil(view.sheetLfo)
  }

  func testRestoredMidRow() {
    open()
    let g = geo(), y = rowMid(g, cutRow)
    view.down(fing(b, g.tx0 + 50, y, t0: 2))
    view.restored()
    rec.acts.removeAll()
    view.move(fing(b, g.tx0 + 90, y, t0: 2, x0: g.tx0 + 50))
    view.up(fing(b, g.tx0 + 90, y, t0: 2, x0: g.tx0 + 50))
    XCTAssertTrue(rec.acts.isEmpty); XCTAssertNil(view.sheetVoice); XCTAssertNil(view.sheetLfo)
  }

  func testHugeValueText() {
    for r in Row.allCases { _ = tenValueText(r, 1e300); _ = tenValueText(r, -1e300); _ = tenValueText(r, .nan); _ = tenValueText(r, .infinity) }
    XCTAssertEqual(tenInt(.nan), 0); XCTAssertEqual(tenInt(1e300), 1_000_000_000)
  }
}
