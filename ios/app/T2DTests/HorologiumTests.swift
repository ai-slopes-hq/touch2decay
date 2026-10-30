import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

final class HorologiumTests: XCTestCase {
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardBuf: [Double] = []
  private let f1 = NSObject(), f2 = NSObject()
  private lazy var view = HorologiumView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    let n = min(self.heardBuf.count, b.count); b.replaceSubrange(0..<n, with: self.heardBuf[0..<n]); self.heardBuf = []; return n
  })
  private var G: HoroGeo { view.geo }
  private var opened: [SheetSpec] = []

  override func setUp() { view.openSheet = { [unowned self] s in self.opened.append(s) } }

  // зеркало: fx 5, run, u, uT, bpm, strip, held, P, F, strikes, locked, затем 8 колец по 4 (on, under, phi, lvl)
  private func setMirror(fx: [Double] = [0, 0.35, 0.4, 1, 0.35], run: Bool = false, u: Double = 0, uT: Double = 0, bpm: Double = 120,
                         P: Double = 0, F: Double = 0, on: [Int] = [], under: [Int] = [], phi: Double = 0.25, lvl: Double = 0.8, now: Double = 1) {
    var b = fx + [run ? 1 : 0, u, uT, bpm, 0, 0, P, F, 0, 0]
    for i in 0..<8 { b += [on.contains(i) ? 1 : 0, under.contains(i) ? 1 : 0, phi, lvl] }
    mirrorBuf = b; view.tick(now: now, dt: 0.016)
  }
  private func finger(_ o: NSObject, _ p: CGPoint, t0: Double = 0, now: Double = 0, p0: CGPoint? = nil) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: t0, moved: false, touchTime: now)
  }
  private func onRing(_ i: Int, _ a: Double) -> CGPoint {
    CGPoint(x: G.cx + CGFloat(sin(a)) * G.ringR(i), y: G.cy - CGFloat(cos(a)) * G.ringR(i))
  }
  private var hub: CGPoint { CGPoint(x: G.cx, y: G.cy) }
  private var bob: CGPoint { G.bobXY(view.pend.th) }
  private func strip(_ t: Double) -> CGPoint { CGPoint(x: G.strip.x0 + (G.strip.x1 - G.strip.x0) * CGFloat(t), y: G.strip.y) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func tap(_ o: NSObject, _ p: CGPoint, at t: Double) {
    view.down(finger(o, p, t0: t, now: t)); view.up(finger(o, p, t0: t, now: t + 0.05))
  }

  // ---------- зеркало, heard, pVis ----------
  func testMirrorParse() {
    var b: [Double] = [0.1, 0.2, 0.3, 0.4, 0.5] + [1, 2, 3, 120, 1, 1, 4.5, 6, 7, 1]
    for i in 0..<8 { b += [1, 0, Double(i) / 10, 0.9] }
    let m = HoroMirror(b, n: 47)!
    XCTAssertEqual(m.fx, [0.1, 0.2, 0.3, 0.4, 0.5]); XCTAssertTrue(m.run); XCTAssertEqual([m.u, m.uT, m.bpm], [2, 3, 120])
    XCTAssertTrue(m.strip); XCTAssertTrue(m.held); XCTAssertEqual([m.P, m.F, m.strikes], [4.5, 6, 7]); XCTAssertTrue(m.locked)
    XCTAssertEqual(m.rings[3].phi, 0.3); XCTAssertEqual(m.rings[7].lvl, 0.9); XCTAssertNil(HoroMirror(b, n: 46))
  }

  func testHeardFlash() {
    setMirror(now: 3)                                       // concursus 0.4 > 0.05
    heardBuf = [2, 3.25, 2, 4]; view.tick(now: 4, dt: 0.016)
    XCTAssertEqual(view.ringHit[2], 4); XCTAssertEqual(view.ringHit[4], 4); XCTAssertLessThan(view.ringHit[3], 0)
    XCTAssertEqual(view.concAt, 4); XCTAssertEqual(view.concA, 0.25 * 2 * .pi, accuracy: 1e-9)
    heardBuf = [1, 5.5, 6]; view.tick(now: 5, dt: 0.016)
    XCTAssertEqual(view.ringHit[6], 5); XCTAssertEqual(view.concAt, 4, "одно кольцо — без луча")
    heardBuf = [2, 1.5, 0, 1]; setMirror(fx: [0, 0.35, 0.05, 1, 0.35], now: 6)
    XCTAssertEqual(view.concAt, 4, "concursus ≤ 0.05 — без луча")
    heardBuf = []; view.tick(now: 7, dt: 0.016)
    XCTAssertEqual(view.ringHit[2], 4, "без ударов вспышка не обновляется")
  }

  func testHeardTwoRecords() {
    setMirror(now: 3)
    heardBuf = [1, 2.5, 3, 2, 3.25, 2, 4]; view.tick(now: 4, dt: 0.016)
    XCTAssertEqual([view.ringHit[3], view.ringHit[2], view.ringHit[4]], [4, 4, 4])
    XCTAssertEqual(view.concAt, 4); XCTAssertEqual(view.concA, 0.25 * 2 * .pi, accuracy: 1e-9, "луч — по P второй записи")
    heardBuf = [1, 0.5, 1, 5, 0.5, 6]; view.tick(now: 5, dt: 0.016)   // обрыв: вторая запись не влезает
    XCTAssertEqual(view.ringHit[1], 5); XCTAssertLessThan(view.ringHit[6], 5)
  }

  func testIdleDrainsWithoutFlash() {
    let v2 = HorologiumView(core: rec, readMirror: { _ in 0 }, readHeard: { [unowned self] b in
      let n = min(self.heardBuf.count, b.count); b.replaceSubrange(0..<n, with: self.heardBuf[0..<n]); self.heardBuf = []; return n })
    heardBuf = [2, 3.25, 2, 4]; v2.idle()
    XCTAssertTrue(heardBuf.isEmpty); XCTAssertTrue(v2.ringHit.allSatisfy { $0 < 0 }); XCTAssertLessThan(v2.concAt, 0)
  }

  func testPVis() {
    setMirror(P: 2, F: 1, now: 10)
    XCTAssertEqual(view.pVis(now: 10.05), 2.05, accuracy: 1e-9)
    XCTAssertEqual(view.pVis(now: 11), 2.1, accuracy: 1e-9)
  }

  // ---------- кольца ----------
  func testRingTap() {
    setMirror()
    tap(f1, onRing(2, 0.3), at: 5)
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [0, 2]); XCTAssertEqual(rec.acts[0].a, [0, 1])
    rec.acts = []; setMirror(on: [2], now: 6)
    tap(f1, onRing(2, 0.3), at: 7)
    XCTAssertEqual(rec.acts[0].a, [0, 0])
  }

  func testRingDoubleTapUnder() {
    setMirror()
    tap(f1, onRing(2, 0.3), at: 5)
    view.down(finger(f1, onRing(2, 0.3), t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.count, 3); XCTAssertEqual(rec.acts[1].a, [1, 1]); XCTAssertEqual(rec.acts[2].a, [0, 1])
    XCTAssertEqual([rec.acts[1].kind, rec.acts[1].i, rec.acts[2].kind, rec.acts[2].i], [0, 2, 0, 2])
    view.up(finger(f1, onRing(2, 0.3), t0: 5.2, now: 5.25))
    XCTAssertEqual(rec.acts.count, 3, "подъём второго тапа ничего не шлёт")
    rec.acts = []; setMirror(on: [2], under: [2], now: 6)
    tap(f1, onRing(2, 0.3), at: 7); view.down(finger(f1, onRing(2, 0.3), t0: 7.2, now: 7.2))
    XCTAssertEqual(rec.acts[1].a, [1, 0], "унтертон уже есть — снимается")
  }

  func testPhaseDrag() {
    setMirror(phi: 0.25)
    let p0 = onRing(3, 0.5)
    view.down(finger(f1, p0, t0: 5, now: 5))
    view.move(finger(f1, onRing(3, 0.7), t0: 5, now: 5.05, p0: p0))
    let m = Horo.mOf(view.mirror.rings[3], aequalis: 0)
    XCTAssertEqual(m, 5)
    var phi = 0.25 - 0.2 / (2 * .pi) * m
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [0, 3]); XCTAssertEqual(rec.acts[0].a[0], 2)
    XCTAssertEqual(rec.acts[0].a[1], phi, accuracy: 1e-9); XCTAssertEqual(view.phaseHeld(), 3)
    view.move(finger(f1, onRing(3, 0.8), t0: 5, now: 5.1, p0: p0))
    phi -= 0.1 / (2 * .pi) * m
    XCTAssertEqual(rec.acts[1].a[1], phi, accuracy: 1e-9, "фаза копится в руке, зеркало не читается")
    view.up(finger(f1, onRing(3, 0.8), t0: 5, now: 5.15))
    XCTAssertEqual(rec.acts.count, 2, "подъём после фазы — без тапа"); XCTAssertNil(view.phaseHeld())
  }

  func testPhaseDragWraps() {                              // RF5: через 6 часов atan2 прыгает на 2π
    setMirror(phi: 0.01)
    let p0 = onRing(2, 3.0)
    view.down(finger(f1, p0, t0: 5, now: 5))
    view.move(finger(f1, onRing(2, -3.0), t0: 5, now: 5.05, p0: p0))
    let d = -6.0 + 2 * .pi, want = ((0.01 - d / (2 * .pi) * 4).truncatingRemainder(dividingBy: 1) + 1).truncatingRemainder(dividingBy: 1)
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].a[1], want, accuracy: 1e-9)
    XCTAssertTrue(rec.acts[0].a[1] >= 0 && rec.acts[0].a[1] < 1); XCTAssertLessThan(min(abs(rec.acts[0].a[1] - 0.01), 1 - abs(rec.acts[0].a[1] - 0.01)), 0.3, "шаг мал, не прыжок на полоборота")
    // обратно через 12 часов: phi остаётся в [0, 1)
    let q0 = onRing(2, 0.05)
    view.down(finger(f2, q0, t0: 6, now: 6))
    view.move(finger(f2, onRing(2, -0.3), t0: 6, now: 6.05, p0: q0))
    XCTAssertTrue(rec.acts[1].a[1] >= 0 && rec.acts[1].a[1] < 1)
  }

  func testRingHoldSheet() {
    setMirror(); view.tick(now: 5, dt: 0.016)
    view.down(finger(f1, onRing(3, 0.3), t0: 5, now: 5))
    view.tick(now: 5.3, dt: 0.016); XCTAssertTrue(opened.isEmpty)
    view.tick(now: 5.5, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(opened[0].title, "circulus V")
    view.tick(now: 5.9, dt: 0.016); XCTAssertEqual(opened.count, 1)
    view.up(finger(f1, onRing(3, 0.3), t0: 5, now: 5.95))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testMovedRingNoSheet() {
    setMirror(); view.tick(now: 5, dt: 0.016)
    let p = onRing(3, 0.3)
    view.down(finger(f1, p, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: p.x + 12, y: p.y), t0: 5, now: 5.1, p0: p))
    view.tick(now: 5.6, dt: 0.016); XCTAssertTrue(opened.isEmpty)
  }

  // ---------- ступица ----------
  func testHubTap() {
    setMirror(run: false, uT: 0.4)
    tap(f1, hub, at: 5)
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 2); XCTAssertEqual(rec.acts[0].a, [1, 0.4])
    rec.acts = []; setMirror(run: true, u: 1.5, uT: 0.4, now: 6)
    tap(f1, hub, at: 7)
    XCTAssertEqual(rec.acts[0].a, [0, 1.5])
  }

  func testHubHoldSheet() {
    setMirror(); view.tick(now: 5, dt: 0.016)
    view.down(finger(f1, hub, t0: 5, now: 5)); view.tick(now: 5.5, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(opened[0].title, "tempus")
    view.up(finger(f1, hub, t0: 5, now: 5.6)); XCTAssertTrue(rec.acts.isEmpty)
  }

  // ---------- шкала ----------
  private func uAt(_ p: CGPoint, bpm: Double = 120) -> Double {
    min(8.5, max(-8, G.uOfX(p.x, Ft: bpm / 240)))
  }

  func testStripHold() {
    setMirror(run: false)
    let p = strip(0.5), u = uAt(p)
    view.down(finger(f1, p, t0: 5, now: 5))
    XCTAssertEqual(kinds(), [2, 6]); XCTAssertEqual(rec.acts[0].a, [1, u]); XCTAssertEqual(rec.acts[1].a, [u, u, 1])
    rec.acts = []; setMirror(run: true, now: 6)
    view.down(finger(f2, strip(0.9), t0: 9, now: 9))
    XCTAssertEqual(kinds(), [6], "ход уже идёт — без RUN")
    let far = CGPoint(x: G.strip.x0 - 10, y: G.strip.y)
    rec.acts = []; view.down(finger(NSObject(), far, t0: 20, now: 20))
        XCTAssertTrue(rec.acts[0].a[0] >= -8 && rec.acts[0].a[0] <= 8.5)
  }

  func testStripDragAndUp() {
    setMirror(run: true)
    view.down(finger(f1, strip(0.5), t0: 5, now: 5))
    rec.acts = []
    let q = strip(0.7), u = uAt(q)
    view.move(finger(f1, q, t0: 5, now: 5.1, p0: strip(0.5)))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a, [u, u, 1])
    view.up(finger(f1, q, t0: 5, now: 5.2))
    XCTAssertEqual(rec.acts[1].a, [u, u, 0])
  }

  func testStripDoubleTap() {
    setMirror(run: true)
    tap(f1, strip(0.5), at: 5)
    rec.acts = []
    view.down(finger(f1, strip(0.5), t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a, [0, 0, 0])
    view.up(finger(f1, strip(0.5), t0: 5.2, now: 5.25)); XCTAssertEqual(rec.acts.count, 1)
    view.down(finger(f1, strip(0.5), t0: 5.3, now: 5.3))
    XCTAssertEqual(rec.acts.last?.a.last, 1, "трекер сброшен — третий тап снова держит шкалу")
  }

  func testDoubleTapTrackersSeparate() {                   // RF3
    setMirror(run: true)
    tap(f1, onRing(2, 0.3), at: 5)
    view.down(finger(f1, strip(0.5), t0: 5.1, now: 5.1))
    XCTAssertEqual(kinds(), [0, 6]); XCTAssertEqual(rec.acts[1].a.last, 1, "после кольца тап по шкале — не сброс скорости")
    view.up(finger(f1, strip(0.5), t0: 5.1, now: 5.15))
    rec.acts = []; setMirror(run: true, now: 8)
    tap(f1, strip(0.5), at: 9)
    tap(f1, onRing(2, 0.3), at: 9.1)
    XCTAssertEqual(kinds(), [6, 6, 0]); XCTAssertEqual(rec.acts[2].a, [0, 1], "после шкалы тап по кольцу — не унтертон")
  }

  // ---------- маятник ----------
  func testPendulumGrab() {
    setMirror()
    view.down(finger(f1, bob, t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 3); XCTAssertEqual(rec.acts[0].a, [1])
    XCTAssertTrue(view.pend.held)
  }

  func testPendulumTap() {
    setMirror(run: false, uT: 0.3)
    tap(f1, bob, at: 5)
    XCTAssertEqual(kinds(), [3, 3, 2]); XCTAssertEqual(rec.acts[1].a, [0]); XCTAssertEqual(rec.acts[2].a, [1, 0.3])
    rec.acts = []; setMirror(run: true, u: 2, uT: 0.3, now: 6)
    tap(f1, bob, at: 7)
    XCTAssertEqual(kinds(), [3, 3, 2]); XCTAssertEqual(rec.acts[2].a, [0, 2], "шёл — тап останавливает")
  }

  func testPendulumSwingByHand() {
    setMirror()
    let p0 = CGPoint(x: G.piv.x + 20, y: G.piv.y + G.L)
    view.down(finger(f1, p0, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: G.piv.x - 20, y: G.piv.y + G.L), t0: 5, now: 5.1, p0: p0))
    XCTAssertEqual(kinds(), [3, 4]); XCTAssertEqual(rec.acts[1].a, [0.25]); XCTAssertEqual(view.pend.handSteps, 1)
    view.move(finger(f1, CGPoint(x: G.piv.x - 30, y: G.piv.y + G.L), t0: 5, now: 5.2, p0: p0))
    XCTAssertEqual(kinds(), [3, 4], "без прохода через низ — без спуска")
  }

  func testPendulumThrow() {
    setMirror()
    let p0 = G.bobXY(0.1)
    view.down(finger(f1, p0, t0: 5, now: 5))
    let q = G.bobXY(0.6)
    view.move(finger(f1, q, t0: 5, now: 5.01, p0: p0))
    view.up(finger(f1, q, t0: 5, now: 5.05))
    XCTAssertEqual(kinds(), [3, 3, 2]); XCTAssertEqual(rec.acts[1].a, [0]); XCTAssertEqual(rec.acts[2].a[0], 1)
    XCTAssertGreaterThan(rec.acts[2].a[1], 0.5); XCTAssertFalse(view.pend.held)
  }

  func testPendulumCatch() {
    setMirror(run: true, u: 1.2, uT: 0.2)
    let p0 = G.bobXY(0.1)
    view.down(finger(f1, p0, t0: 5, now: 5))
    let q = G.bobXY(0.2)
    view.move(finger(f1, q, t0: 5, now: 5.01, p0: p0))
    view.up(finger(f1, q, t0: 5, now: 5.5))
    XCTAssertEqual(kinds(), [3, 3, 2]); XCTAssertEqual(rec.acts[2].a, [0, 1.2], "держал неподвижно — поймал, стоп")
  }

  func testPendulumAndRingTwoFingers() {                   // RF1
    setMirror()
    view.down(finger(f1, bob, t0: 5, now: 5))
    tap(f2, onRing(2, 0.3), at: 5.5)
    XCTAssertEqual(kinds(), [3, 0]); XCTAssertEqual(rec.acts[1].a, [0, 1])
    XCTAssertTrue(view.pend.held, "маятник остался в руке")
  }

  func testRestoredFreesPendulumAndStrip() {               // RF2
    setMirror(run: true, u: 1.5, uT: 0.5)
    view.down(finger(f1, bob, t0: 5, now: 5)); view.down(finger(f2, strip(0.5), t0: 5.1, now: 5.1))
    rec.acts = []
    view.restored()
    XCTAssertEqual(kinds(), [3, 6]); XCTAssertEqual(rec.acts[0].a, [0]); XCTAssertEqual(rec.acts[1].a, [1.5, 0.5, 0])
    XCTAssertFalse(view.pend.held)
    view.up(finger(f1, bob, t0: 5, now: 5.5)); view.up(finger(f2, strip(0.5), t0: 5.1, now: 5.5))
    XCTAssertEqual(rec.acts.count, 2, "после restored подъёмы ничего не шлют")
    XCTAssertTrue(view.holds.isEmpty)
  }

  func testCancelFreesPendulum() {
    setMirror(run: true, u: 1.5, uT: 0.5)
    view.down(finger(f1, bob, t0: 5, now: 5)); view.down(finger(f2, strip(0.5), t0: 5.1, now: 5.1))
    rec.acts = []
    view.cancel(finger(f1, bob, t0: 5, now: 5.5))
    XCTAssertEqual(kinds(), [3]); XCTAssertEqual(rec.acts[0].a, [0])
    view.cancel(finger(f2, strip(0.5), t0: 5.1, now: 5.5))
    XCTAssertEqual(kinds(), [3, 6]); XCTAssertEqual(rec.acts[1].a, [1.5, 0.5, 0])
    view.up(finger(f1, bob, t0: 5, now: 6)); XCTAssertEqual(rec.acts.count, 2)
  }

  // ---------- плашки ----------
  func testRingSheet() {
    setMirror(on: [2], phi: 0.25, lvl: 0.8)
    let s = view.ringSpec(2)
    XCTAssertEqual(s.title, "circulus IV")
    XCTAssertEqual(s.rows.map(\.key), ["on", "under", "phi", "lvl"]); XCTAssertEqual(s.rows.map(\.label), ["sounds", "undertone", "phase", "level"])
    XCTAssertEqual(s.rows.map(\.code), [-1, -1, 9, 10]); XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.keys, ["phi", "lvl"]); XCTAssertEqual(s.lfo?.shape, 0)
    XCTAssertEqual(["on", "under", "phi", "lvl"].map(s.text), ["yes", "4 a turn", "90°", "80%"])
    XCTAssertEqual(s.get("on"), 1); XCTAssertEqual(s.get("phi"), 0.25)
    s.set("under", 0.7)
    XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [0, 2]); XCTAssertEqual(rec.acts[0].a, [1, 1])
    s.set("lvl", 0.5); XCTAssertEqual(rec.acts[1].a, [3, 0.5])
    s.set("on", 0.2); XCTAssertEqual(rec.acts[2].a, [0, 0])
    setMirror(on: [2], under: [2], now: 2)
    XCTAssertEqual(view.ringSpec(2).text("under"), "1/4 · 3 a turn")
    XCTAssertEqual(view.ringSpec(3).text("under"), "5 a turn"); XCTAssertEqual(view.ringSpec(0).rows.map(\.code), [-1, -1, 5, 6])
  }

  func testHubSheet() {
    setMirror(bpm: 120)
    let s = view.hubSpec()
    XCTAssertEqual(s.title, "tempus"); XCTAssertEqual(s.rows.map(\.key), ["bpm"]); XCTAssertEqual(s.rows.map(\.label), ["tempo"]); XCTAssertEqual(s.rows.map(\.code), [-1])
    XCTAssertNil(s.lfo); XCTAssertEqual(s.get("bpm"), 0.5); XCTAssertEqual(s.text("bpm"), "120 bpm")
    s.set("bpm", 0.25)
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 5); XCTAssertEqual(rec.acts[0].a, [80])
  }

  func testFanSheet() {
    setMirror(fx: [0.4, 0.35, 0.4, 1, 0.6])
    let s = view.fx!
    XCTAssertEqual(s.title, "aether"); XCTAssertEqual(s.rows.map(\.key), ["aequalis", "materia", "concursus", "chance", "hall"])
    XCTAssertEqual(s.rows.map(\.code), [0, 1, 2, 3, 4]); XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.shape, 1)
    XCTAssertEqual(s.lfo?.keys, ["aequalis", "materia", "concursus", "chance", "hall"]); XCTAssertEqual(s.arc?(), 0.6)
    XCTAssertEqual(s.text("aequalis"), "40% equal"); XCTAssertEqual(s.text("materia"), "lignum 35%"); XCTAssertEqual(s.text("concursus"), "40%")
    setMirror(fx: [0, 0.6, 0.4, 1, 0.6], now: 2); XCTAssertEqual(s.text("aequalis"), "pure"); XCTAssertEqual(s.text("materia"), "metallum 60%")
    setMirror(fx: [1, 0.6, 0.4, 1, 0.6], now: 3); XCTAssertEqual(s.text("aequalis"), "equal")
    s.set("chance", 0.3); XCTAssertEqual(rec.acts[0].kind, 1); XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [0.3])
  }

  // ---------- кубик, корзина, угол, легенда ----------
  func testDice() {
    setMirror()
    view.pend.th = 0.2
    view.dice()
    XCTAssertEqual(kinds(), [8])
    let A = acos(1 - min(1.9, Horo.eOfU(0)))
    XCTAssertEqual(view.pend.ph, asin(0.2 / A), accuracy: 1e-9)
  }

  func testClear() { view.clear(); XCTAssertEqual(kinds(), [7]) }

  func testCornerHit() {
    XCTAssertTrue(view.cornerHit(G.W - 10, 61 + 10)); XCTAssertFalse(view.cornerHit(G.W - 10, 50))
    XCTAssertFalse(view.cornerHit(G.W / 2, 100))
  }

  func testLegend() {
    let l = view.legend
    XCTAssertEqual(l.count, 8)
    XCTAssertEqual(l.map(\.glyph), [.tap, .double, .drag, .hold, .throw, .drag, .tap, .tap])
    XCTAssertEqual(l.map(\.gesture), ["tap a ring", "double tap a ring", "drag along a ring", "hold a ring", "swing the pendulum",
                                      "drag along the tempus scale", "tap the hub", "tap the sun"])
    XCTAssertEqual(l.map(\.does), ["it sounds: n strikes a turn, the n-th harmonic", "undertone 1/n", "its phase", "its sheet",
                                   "by hand — it ticks · throw — faster · over the top — a chord · catch — stop",
                                   "speed: rhythm … tone · double tap — back to tempo", "run / stop · hold — tempo", "map of worlds"])
    XCTAssertEqual(view.title, "Horologium"); XCTAssertEqual(view.sub, "numeri · horae")
  }
  // ---------- рисование ----------
  private func render(_ v: HorologiumView, now: Double) {
    let W = Int(v.geo.W), H = Int(v.geo.H)
    let g = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    g.translateBy(x: 0, y: CGFloat(H)); g.scaleBy(x: 1, y: -1)
    let d = Draw(g: g, W: CGFloat(W), H: CGFloat(H)); d.setTheme(v.theme)
    v.draw(d, now: now)
  }

  func testWallCached() {
    setMirror(on: [0, 2])
    render(view, now: 1); render(view, now: 1.1)
    XCTAssertEqual(view.wallBuilds, 1, "два кадра — одна стена")
    view.layout(W: 390, H: 800, topY: 59, safeBot: 34); render(view, now: 1.2)
    XCTAssertEqual(view.wallBuilds, 2, "высота сменилась")
  }

  func testDrawNoCrashEmpty() {
    mirrorBuf = []; view.tick(now: 1, dt: 0.016)       // мир ещё не отдал снимок — зеркало по умолчанию
    render(view, now: 1)
    XCTAssertEqual(view.wallBuilds, 1)
  }

  func testDrawSpin() {
    setMirror(run: true, u: 7.5, uT: 0, P: 3.4, F: 30, on: [0, 1, 4], under: [1])
    _ = view.pend.grab(0.3); _ = view.pend.release(th: 0.3, om: 12)    // бросок через верх: spin
    XCTAssertTrue(view.pend.spin)
    render(view, now: 2)
    XCTAssertEqual(view.wallBuilds, 1)
  }
}
