import XCTest
@testable import T2D

// кадр Tenebrae целиком: поле, волны, нити, мост, удержание, отказ, кольцо связи (app.js:1906-1979)
final class TenFrameTests: XCTestCase {
  override class func setUp() { tenRegisterFonts() }
  private let rig = TenRig()
  private var view: TenebraeView { rig.view }
  private let now = 5.0
  private let fid = NSObject()

  private func win(_ x: Double, _ y: Double, _ s: Double) -> CGRect { CGRect(x: x - s / 2, y: y - s / 2, width: s, height: s) }
  private func frame(_ t: Double? = nil) -> CGImage { tenShot(view) { d in self.view.drawFrame(d, now: t ?? self.now) } }
  private func lit(_ r: CGRect, over: UInt8 = 24, at t: Double? = nil) -> Int { tenLit(frame(t), r, over: over) }
  private func bytes(_ img: CGImage) -> Data { img.dataProvider!.data! as Data }

  // связь: dst, src, тип, глубина
  private func put(_ b: inout [Double], _ i: Int, x: Double, y: Double, links: [(src: Int, type: Int, depth: Double, auto: Bool)] = []) {
    rig.voice(&b, i, x: x, y: y)
    let o = Ten.head + Ten.voiceN * i
    b[o + 17] = Double(links.count)
    for (k, l) in links.enumerated() { let q = o + 18 + 4 * k; b[q] = Double(l.src); b[q + 1] = Double(l.type); b[q + 2] = l.depth; b[q + 3] = l.auto ? 1 : 0 }
  }
  private func twoVoices(depth: Double = 0.5, auto: Bool = false, scope: Bool = true) {
    rig.mirror { b in
      self.put(&b, 0, x: 0.25, y: 0.3, links: [(1, 0, depth, auto)])
      self.put(&b, 1, x: 0.6, y: 0.5)
      if scope { self.rig.scope(&b, 0, peak: 0.5); self.rig.scope(&b, 1, peak: 0.5) }
    }
    for k in 0..<5 { rig.tick(now - 0.1 + Double(k) * 0.02) }
    view.touchedOnce = true
  }

  func testFrameBeforeTick() {
    _ = frame()                                              // свежий вид, зеркала нет
    rig.tick(1)                                              // зеркало без живых
    _ = frame()
    _ = tenShot(view) { d in self.view.drawFrame(d, now: 0) }
  }

  func testFramePure() {
    twoVoices()
    view.waves = [TenWave(x: 100, y: 300, r: 60, a: 1, sp: 40, dash: false), TenWave(x: 200, y: 500, r: 40, a: 1, sp: 40, dash: true)]
    view.strikes = [(0, now - 0.05, 0.8, 0.5)]
    let w = view.waves.count, s = view.strikes.count, pk = view.vw.map(\.pk), z = view.zoom
    let img1 = frame(), img2 = frame()
    XCTAssertEqual(bytes(img1), bytes(img2))
    XCTAssertEqual(view.waves.count, w); XCTAssertEqual(view.strikes.count, s)
    XCTAssertEqual(view.vw.map(\.pk), pk); XCTAssertEqual(view.zoom, z); XCTAssertEqual(view.fingers.count, 0)
  }

  func testGhostFirstTouch() {
    let x = 390 * 0.35, y = 844 * 0.6
    let w = win(x + 65, y, 14)
    let before = lit(w, over: 12)
    XCTAssertGreaterThan(before, 0)
    view.down(Finger(id: ObjectIdentifier(fid), x: 30, y: 250, x0: 30, y0: 250, t0: now, moved: false, touchTime: now))
    view.up(Finger(id: ObjectIdentifier(fid), x: 30, y: 250, x0: 30, y0: 250, t0: now, moved: false, touchTime: now + 0.05))
    XCTAssertTrue(view.touchedOnce)
    XCTAssertGreaterThan(before, lit(w, over: 12), "после касания призрака нет")
    XCTAssertEqual(lit(win(x + 146, y, 8), over: 24), lit(win(x + 146, y, 8), over: 24))
  }

  func testZoomCaption() {
    view.touchedOnce = true
    let w = CGRect(x: 195 - 40, y: view.geo.top + 76 - 10, width: 80, height: 20)
    view.zoomShow = now - 1
    let off = lit(w)                                         // фон (орбиты, звёзды) в окне свой — сравниваем с ним
    view.zoomShow = now + 1
    XCTAssertGreaterThan(lit(w), off)
  }

  func testLinkDiamond() {
    twoVoices(auto: false)
    let m = view.linkMid(dst: 0, src: 1)
    let manual = lit(win(m.x, m.y, 12))
    twoVoices(auto: true)
    XCTAssertGreaterThan(manual, lit(win(m.x, m.y, 12)), "у auto-связи ручки нет")
    XCTAssertGreaterThan(manual, 0)
  }

  func testLinkParticles() {
    twoVoices()
    let a = frame(5), b = frame(5.37)
    XCTAssertNotEqual(bytes(a), bytes(b), "частицы и пунктир бегут")
  }

  func testRingPinned() {
    twoVoices()
    let R2 = Ten.menuDead + view.geo.menuSpan, cx = 195.0, cy = 420.0
    let w = win(cx + R2, cy, 6), c = view.closeChip
    let chipW = win(c.x + c.w / 2, c.y, 6)
    let before = lit(chipW)
    view.ring = TenRing(dst: 0, src: 1, cx: cx, cy: cy, pinned: true)
    XCTAssertGreaterThan(lit(w, over: 5), 0, "окружность R2 (альфа 0.08, штрих делится на два пикселя)")
    XCTAssertGreaterThan(lit(chipW), before)
    view.sheetVoice = 0
    XCTAssertEqual(lit(chipW), before, "при плашке чипа нет")
  }

  func testRingHung() {
    twoVoices()
    var r = TenRing(dst: 0, src: 1, cx: 195, cy: 420)
    r.overPin = true
    let before = lit(win(195, 420 - Ten.pinR - 5, 6))
    view.ring = r
    XCTAssertGreaterThan(lit(win(195, 420 - Ten.pinR - 5, 6)), before, "булавка на кольце на весу")
    var g = r; g.overPin = false
    view.ring = nil
    view.ghost = (g, now + 1)
    XCTAssertGreaterThan(lit(win(195, 420 - Ten.pinR, 8)), 0, "призрак")
    view.ghost = (g, now - 1)
    XCTAssertEqual(lit(win(195, 420 - Ten.pinR, 8), over: 60), 0, "призрак погас")
  }

  func testHoldArc() {
    twoVoices()
    let p = view.screenPos(0), w = win(p.x, p.y - 46, 6)
    let id = ObjectIdentifier(fid)
    view.fingers[id] = TenFinger(id: id, x0: p.x, y0: p.y, t0: now - 0.3, x: p.x, y: p.y, v: 0, caught: true)
    let before = lit(w, over: 60)
    view.hold = (id, now - 0.3)
    XCTAssertGreaterThan(lit(w, over: 60), before)
  }

  func testRefuseExpires() {
    view.touchedOnce = true
    view.refuse = (200, 400, now)
    let w = win(200 + 34, 400, 8)
    XCTAssertGreaterThan(lit(w, over: 60), 0)
    rig.tick(now + 0.7)
    XCTAssertEqual(lit(w, over: 60, at: now + 0.7), 0)
  }

  func testFullExpires() {
    view.touchedOnce = true
    view.full = [(200, 400, now)]
    let w = win(200 + 34, 400, 8)
    XCTAssertGreaterThan(lit(w, over: 60), 0)
    XCTAssertEqual(lit(w, over: 60, at: now + 0.7), 0, "кадр не ждёт tick")
  }

  func testBridge() {
    twoVoices()
    let a = ObjectIdentifier(fid), o2 = NSObject(), b = ObjectIdentifier(o2)
    view.fingers[a] = TenFinger(id: a, x0: 60, y0: 250, t0: now, x: 60, y: 250, v: 0, caught: true, wasBridge: true)
    view.fingers[b] = TenFinger(id: b, x0: 330, y0: 650, t0: now, x: 330, y: 650, v: 1, caught: true, wasBridge: true)
    let mid = (x: 195.0, y: 450.0)
    let before = lit(win(mid.x, mid.y, 40))
    view.bridge = TenBridge(a: 0, b: 1, fa: a, fb: b, d0: 100, depth0: 0.5, depth: 0.5)
    XCTAssertGreaterThan(lit(win(330, 650, 8)), 0, "точка пальца")
    XCTAssertGreaterThan(lit(win(mid.x, mid.y, 40)), before, "спираль")
    _ = o2
  }

  func testChaosStars() {
    twoVoices()
    let calm = frame()
    rig.mirror { b in
      self.put(&b, 0, x: 0.25, y: 0.3, links: [(1, 0, 0.5, false)]); self.put(&b, 1, x: 0.6, y: 0.5)
      self.rig.scope(&b, 0, peak: 0.5); self.rig.scope(&b, 1, peak: 0.5)
      b[6] = 1                                               // chaos
    }
    for k in 0..<5 { rig.tick(now - 0.1 + Double(k) * 0.02) }
    XCTAssertNotEqual(bytes(calm), bytes(frame()), "звёзды мерцают")
  }

  func testLinksHuge() {
    rig.mirror { b in
      self.put(&b, 0, x: 0.25, y: 0.3, links: [(1, 2, 1e300, false)])
      self.put(&b, 1, x: 0.6, y: 0.5)
      let o = Ten.head
      b[o + 6] = 1e300; b[o + Ten.voiceN + 6] = 1e300      // beat
      b[o + 12] = 1e300                                       // amp
      b[o + 15] = 1e300; b[o + Ten.voiceN + 15] = 1e300       // env
      b[3] = 1e300; b[4] = 1e300; b[5] = 1e300; b[6] = 1e300; b[7] = 1e300   // fx
    }
    for k in 0..<5 { rig.tick(now - 0.1 + Double(k) * 0.02) }
    view.zoomShow = now + 1
    view.ring = TenRing(dst: 0, src: 1, cx: 195, cy: 420, pinned: true)
    _ = frame()
    view.ring = TenRing(dst: 0, src: 1, cx: 195, cy: 420)
    _ = frame()
  }

  func testScaleNames() {
    twoVoices()
    view.scale(pcs: [0, 2, 4, 5, 7, 9, 11], root: 3)
    rig.tick(now)
    let p = view.screenPos(0)
    let id = ObjectIdentifier(fid)
    view.fingers[id] = TenFinger(id: id, x0: p.x, y0: p.y, t0: now, x: p.x, y: p.y, v: 0, caught: true)
    _ = frame()
  }
}
