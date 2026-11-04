import XCTest
@testable import T2D

// плашка планеты и панель LFO Tenebrae (app.js:1982-2024, :1429-1502)
final class TenSheetDrawTests: XCTestCase {
  override class func setUp() { tenRegisterFonts() }
  private let rig = TenRig()
  private var view: TenebraeView { rig.view }
  private let now = 5.0

  private func setup(cut: Double = 0.4, lfo: (k: Int, morph: Double, rate: Double, depth: Double)? = nil,
                     amp: Double = 1, beat: Double = 0.35) {
    rig.mirror { b in
      self.rig.voice(&b, 0, beat: beat)
      let o = Ten.head + Ten.voiceN * 0
      b[o + 9] = cut; b[o + 12] = amp
      if let l = lfo { let q = o + 38 + 3 * l.k; b[q] = l.morph; b[q + 1] = l.rate; b[q + 2] = l.depth }
    }
    for k in 0..<5 { rig.tick(now - 0.1 + Double(k) * 0.02) }
    view.touchedOnce = true
  }
  private func frame() -> CGImage { tenShot(view) { d in self.view.drawFrame(d, now: self.now) } }
  private func win(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect { CGRect(x: x, y: y, width: w, height: h) }

  func testSheetRows() {
    setup()
    let g0 = view.sheetGeo
    let rowWins = (0..<tenSheetRows.count).map { win(g0.tx0 + 10, g0.rowY($0) + 20 - 1, g0.tx1 - g0.tx0 - 20, 3) }
    let strip = win(g0.x, g0.waveY, g0.w, 40)
    let off = frame()
    for w in rowWins + [strip] { XCTAssertLessThan(tenLit(off, w, over: 60), 40, "без плашки только поле") }
    view.sheetVoice = 0
    let img = frame()
    for (i, w) in rowWins.enumerated() { XCTAssertGreaterThan(tenLit(img, w, over: 60), 100, "линия строки \(i)") }
    XCTAssertGreaterThan(tenLit(img, strip, over: 60), 100, "полоса волн")
  }

  func testSheetSlider() {
    setup(cut: 0.68)
    view.sheetVoice = 0
    let g = view.sheetGeo
    let cy = g.rowY(0) + TenSheetGeo.rowH / 2
    let x = g.tx0 + tenNorm(Row.cut, 0.68) * (g.tx1 - g.tx0)
    let img = frame()
    XCTAssertGreaterThan(tenLit(img, win(x - 5, cy - 5, 10, 10), over: 200), 50, "ручка на 0.68")
    XCTAssertEqual(tenLit(img, win(x + 25, cy - 5, 10, 10), over: 200), 0, "в стороне от ручки")
  }

  func testLfoPanel() {
    setup(lfo: (LfoKey.cut.rawValue, 0.5, 1.0, 0.9))
    view.sheetVoice = 0
    view.sheetLfo = LfoKey.cut
    let p = view.sheetGeo.panel!
    let cx = Double(Pad.rateX(p, 1.0)), cy = Double(Pad.depthY(p, 0.9))
    let ringWin = win(cx - 5, cy - 5, 10, 10)
    let padWin = CGRect(x: p.x, y: p.pad.y, width: p.w, height: p.pad.h)
    let open = frame()
    XCTAssertGreaterThan(tenLit(open, padWin, over: 60), 300, "пад нарисован")
    XCTAssertGreaterThan(tenLit(open, ringWin, over: 200), 8, "кольцо и точка на (rate, depth)")
    view.sheetLfo = nil
    XCTAssertNil(view.sheetGeo.panel)
    let closed = frame()
    XCTAssertEqual(tenLit(closed, ringWin, over: 200), 0, "без панели в этом месте света нет")
    // заголовок «LFO → cutoff» в панели
    let title = win(Double(p.x), Double(p.top), 120, 18)
    XCTAssertGreaterThan(tenLit(open, title, over: 100), 10)
  }

  func testLiveRange() {
    setup(lfo: (LfoKey.cut.rawValue, 0, 1, 0.5))
    let r = view.liveRange(0, Row.cut)!
    XCTAssertLessThan(r.lo, 0.4); XCTAssertGreaterThan(r.hi, 0.4)
    XCTAssertNil(view.liveRange(0, Row.res), "LFO нет")
    XCTAssertNil(view.liveRange(0, Row.amp))
  }

  func testSheetHuge() {
    setup(cut: 1e300, lfo: (LfoKey.cut.rawValue, 1e300, 1e300, 1e300), amp: 1e300, beat: 1e300)
    view.sheetVoice = 0
    view.sheetLfo = LfoKey.cut
    _ = frame()
    view.sheetLfo = LfoKey.pitch
    _ = frame()
    view.sheetLfo = nil
    _ = frame()
  }
}
