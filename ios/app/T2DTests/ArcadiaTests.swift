import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  var failAdd = false
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool {
    if failAdd && kind == 0 { return false }
    acts.append((kind, i, a, touchTime)); return true
  }
}

final class ArcadiaTests: XCTestCase {
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var rngs: [Double] = [], rngAt = 0
  private var build: (UInt32) -> ArcPic? = { _ in nil }
  private let f1 = NSObject(), f2 = NSObject()
  private var gone: [Int] = [], opened: [SheetSpec] = []
  private var t = 1.0
  private lazy var view = ArcadiaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, rng: { [unowned self] in let r = self.rngs[self.rngAt]; self.rngAt += 1; return r },
     loader: ArcPicLoader(build: { [unowned self] s in self.build(s) }, queue: nil))
  private var G: ArcGeo { view.geo }

  override func setUp() {
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    view.objGone = { [unowned self] s in self.gone.append(s) }
  }

  private func slot(_ u: Double, _ v: Double, mode: Double = 2, r: Double = 0.16, rs: Double = 0.16, cx: Double? = nil, cy: Double? = nil) -> ArcSlot {
    ArcSlot(on: true, u: u, v: v, oct: 0, r: r, fig: 0, mode: mode, sp: 0.22, lvl: 0.8, f: 220, cx: cx ?? u, cy: cy ?? v, rs: rs, gain: 0.5)
  }
  // зеркало: fx 7, seed, pending, 4 слота по 14
  private func setMirror(_ slots: [Int: ArcSlot] = [:], seed: Double = 7, dt: Double = 0.016) {
    var b: [Double] = ArcMirror.fxDef + [seed, 0]
    for s in 0..<4 {
      if let q = slots[s] {
        b += [1, q.u, q.v, q.oct, q.r, q.fig, q.mode, q.sp, q.lvl, q.f, q.cx, q.cy, q.rs, q.gain]
      } else { b += [Double](repeating: 0, count: 14) }
    }
    mirrorBuf = b; t += dt; view.tick(now: t, dt: dt)
  }
  private func finger(_ o: NSObject, _ p: CGPoint, p0: CGPoint? = nil, now: Double = 0) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: 0, moved: false, touchTime: now)
  }
  private func flag(_ s: Int) -> CGPoint { G.at(view.zAt, view.value(s, key: 0), view.value(s, key: 1)) }
  private var land: CGPoint { CGPoint(x: G.cx, y: G.hor + 120) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func flat(_ seed: UInt32, lakeLeft: Bool = false) -> ArcPic {
    var lake = [Float](repeating: 0, count: Arc.gx * Arc.gy)
    if lakeLeft { for j in 0..<Arc.gy { for i in 0..<40 { lake[j * Arc.gx + i] = 1 } } }
    return ArcPic(seed: seed, z: [Float](repeating: 0, count: Arc.gx * Arc.gy), lake: lake, peaks: [], lakes: [], rivers: [])
  }
  private func four() -> [Int: ArcSlot] { [0: slot(-0.8, -0.5), 1: slot(0.8, -0.5), 2: slot(-0.8, 0.5), 3: slot(0.8, 0.5)] }

  // ---------- земля, слоты ----------
  func testDownLandAdds() {
    setMirror()
    let q = G.pick(view.zAt, land.x, land.y)!
    view.down(finger(f1, land, now: 2))
    XCTAssertEqual(kinds(), [0]); let a = rec.acts[0]
    XCTAssertEqual(a.i, 0); XCTAssertEqual(a.a.count, 8)
    XCTAssertEqual(a.a[0], q.u, accuracy: 1e-9); XCTAssertEqual(a.a[1], max(-0.98, min(0.98, q.v)), accuracy: 1e-9)
    XCTAssertEqual(Array(a.a[2...]), [0, 0.16, 0, 2, 0.22, 0.8]); XCTAssertEqual(a.t, 2)
    let h = view.holds[ObjectIdentifier(f1)]!
    XCTAssertEqual(h.kind, .home); XCTAssertTrue(h.fresh)
    view.up(finger(f1, land, now: 2.05)); XCTAssertEqual(kinds(), [0], "подъём свежего странника не убирает")
  }

  func testDownLandClampsV() {
    setMirror()
    view.down(finger(f1, CGPoint(x: G.cx, y: G.gb + 20)))
    XCTAssertEqual(rec.acts[0].a[1], -0.98, accuracy: 1e-9)
  }

  func testTouchBeforePic() {                              // RF4: страны нет — земля плоская, ADD работает
    setMirror(); XCTAssertNil(view.pic)
    view.down(finger(f1, land))
    XCTAssertEqual(kinds(), [0])
  }

  func testSkyTap() {                                      // RF4
    setMirror()
    view.down(finger(f1, CGPoint(x: G.cx, y: G.hor - 20)))
    XCTAssertTrue(rec.acts.isEmpty); XCTAssertEqual(view.holds[ObjectIdentifier(f1)]?.kind, Optional(.none))
  }

  func testNoFreeSlot() {                                  // RF4
    setMirror(four())
    view.down(finger(f1, land))
    XCTAssertTrue(rec.acts.isEmpty); XCTAssertEqual(view.holds[ObjectIdentifier(f1)]?.kind, Optional(.none))
  }

  func testPendingSlotsSameFrame() {
    setMirror()
    view.down(finger(f1, land)); view.down(finger(f2, CGPoint(x: G.cx + 120, y: G.hor + 200)))
    XCTAssertEqual(rec.acts.map(\.i), [0, 1]); XCTAssertEqual(kinds(), [0, 0])
  }

  func testAddLostFreesSlot() {
    setMirror(); rec.failAdd = true
    view.down(finger(f1, land)); XCTAssertTrue(rec.acts.isEmpty); XCTAssertFalse(view.state.isAlive(0))
    rec.failAdd = false
    view.down(finger(f2, land)); XCTAssertEqual(rec.acts.map(\.i), [0])
  }

  // ---------- флажок ----------
  func testHomeMove() {
    setMirror([0: slot(0, 0)])
    let p = flag(0), to = CGPoint(x: p.x + 40, y: p.y + 60)
    view.down(finger(f1, p, now: 2)); view.move(finger(f1, CGPoint(x: p.x + 3, y: p.y), p0: p, now: 2.01))
    XCTAssertTrue(rec.acts.isEmpty, "сдвиг ≤ 8 px — не тяга")
    view.move(finger(f1, to, p0: p, now: 2.02))
    XCTAssertEqual(kinds(), [2]); XCTAssertEqual(rec.acts[0].i, 0)
    let q = G.pick(view.zAt, min(max(to.x, CGFloat(G.fx0)), CGFloat(G.fx1)), max(to.y, CGFloat(G.hor) - 30))!
    XCTAssertEqual(rec.acts[0].a[0], q.u, accuracy: 1e-9); XCTAssertEqual(rec.acts[0].a[1], q.v, accuracy: 1e-9)
    XCTAssertEqual(view.value(0, key: 0), q.u, accuracy: 1e-9, "свои значения — без отставания на кадр")
    view.move(finger(f1, CGPoint(x: to.x, y: G.hor - 100), p0: p, now: 2.03))
    XCTAssertEqual(rec.acts[1].a[1], 0.98, accuracy: 1e-9, "выше горизонта — край: v зажат")
  }

  func testHomeTapDrops() {
    setMirror([0: slot(0, 0)])
    let p = flag(0)
    view.down(finger(f1, p, now: 2)); view.up(finger(f1, p, now: 2.1))
    XCTAssertEqual(kinds(), [1]); XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(gone, [0])
    XCTAssertFalse(view.state.isAlive(0))
  }

  func testHomeSlowReleaseNoDrop() {
    setMirror([0: slot(0, 0)])
    let p = flag(0)
    view.down(finger(f1, p, now: 2)); view.up(finger(f1, p, now: 2.4))
    XCTAssertTrue(rec.acts.isEmpty, "≥ 300 мс — не тап")
  }

  func testHomeHoldSheet() {
    setMirror([0: slot(0, 0)])
    let p = flag(0)
    view.down(finger(f1, p, now: 2)); setMirror([0: slot(0, 0)], dt: 0.3); XCTAssertTrue(opened.isEmpty)
    setMirror([0: slot(0, 0)], dt: 0.2)
    XCTAssertEqual(opened.map(\.title), ["viator"])
    view.up(finger(f1, p, now: 3)); XCTAssertTrue(rec.acts.isEmpty, "после плашки подъём не убирает")
  }

  // ---------- край ----------
  func testRimDrag() {
    let s = slot(0, 0, r: 0.3, rs: 0.3)
    setMirror([0: s])
    var buf = [CGPoint](repeating: .zero, count: 49)
    _ = G.loopPts(view.zAt, fig: 0, u: 0, v: 0, r: 0.3, n: 48, into: &buf)
    let rim = buf[12]
    view.down(finger(f1, rim)); XCTAssertEqual(view.holds[ObjectIdentifier(f1)]?.kind, Optional(.rim)); XCTAssertTrue(rec.acts.isEmpty)
    let to = G.proj(0.25, 0)
    view.move(finger(f1, CGPoint(x: to.x, y: to.y), p0: rim))
    XCTAssertEqual(kinds(), [3]); XCTAssertEqual(rec.acts[0].i, 0)
    XCTAssertEqual(rec.acts[0].a[0], 3); XCTAssertEqual(rec.acts[0].a[1], 0.25, accuracy: 1e-6); XCTAssertEqual(rec.acts[0].a[2], 0)
    XCTAssertEqual(view.value(0, key: 3), 0.25, accuracy: 1e-6)
    let far = G.proj(0.9, 0)
    view.move(finger(f1, CGPoint(x: far.x, y: far.y), p0: rim)); XCTAssertEqual(rec.acts[1].a[1], 0.6, accuracy: 1e-9, "r ≤ 0.6")
  }

  func testRimUnderFlagIsHome() {                          // петля проходит через флажок — флажок важнее
    setMirror([0: slot(0, 0, r: 0.3, rs: 0.3, cx: -0.3, cy: 0)])   // точка k = 0 круга — прямо в (0, 0)
    view.down(finger(f1, flag(0)))
    XCTAssertEqual(view.holds[ObjectIdentifier(f1)]?.kind, Optional(.home))
  }

  func testRimSkippedForTinyOrbit() {
    setMirror([0: slot(0, 0, r: 0.05, rs: 0.3)])
    var buf = [CGPoint](repeating: .zero, count: 49)
    _ = G.loopPts(view.zAt, fig: 0, u: 0, v: 0, r: 0.3, n: 48, into: &buf)
    view.down(finger(f1, buf[0]))
    XCTAssertEqual(kinds(), [0], "r < 0.06 — край пропущен, это земля")
  }

  // ---------- два пальца ----------
  func testTwoFingersHomeAndAdd() {                        // RF1
    setMirror([0: slot(0, 0)])
    let p = flag(0)
    view.down(finger(f1, p, now: 2)); view.move(finger(f1, CGPoint(x: p.x + 30, y: p.y + 40), p0: p, now: 2.01))
    view.down(finger(f2, CGPoint(x: G.cx - 100, y: G.hor + 250), now: 2.02))
    XCTAssertEqual(kinds(), [2, 0]); XCTAssertEqual(rec.acts.map(\.i), [0, 1])
    view.move(finger(f1, CGPoint(x: p.x + 40, y: p.y + 60), p0: p, now: 2.03)); XCTAssertEqual(kinds(), [2, 0, 2]); XCTAssertEqual(rec.acts[2].i, 0, "флажок остался в руке")
    view.up(finger(f2, CGPoint(x: G.cx - 100, y: G.hor + 250), now: 2.04)); view.up(finger(f1, p, now: 2.05))
    XCTAssertFalse(kinds().contains(1), "лишнего DROP нет")
  }

  func testHeldLastFingerWins() {
    setMirror([0: slot(0, 0, r: 0.3, rs: 0.3)])
    var buf = [CGPoint](repeating: .zero, count: 49)
    _ = G.loopPts(view.zAt, fig: 0, u: 0, v: 0, r: 0.3, n: 48, into: &buf)
    view.down(finger(f1, flag(0))); XCTAssertEqual(view.heldRim(0), false)
    view.down(finger(f2, buf[12])); XCTAssertEqual(view.heldRim(0), true)
    view.up(finger(f2, buf[12])); XCTAssertEqual(view.heldRim(0), false)
    view.cancel(finger(f1, flag(0))); XCTAssertNil(view.heldRim(0))
    view.holdShot(1, rim: true); XCTAssertEqual(view.heldRim(1), true)
  }

  // ---------- след, угол, легенда ----------
  func testTrailTicks() {
    let s = slot(0, 0, mode: 2, cx: 0.3, cy: 0.4)
    setMirror([0: s]); view.tick(now: 0, dt: 0)
    for _ in 0..<10 { setMirror([0: s], dt: 0.05) }
    XCTAssertEqual(view.state.trailCount(0), 3, "раз в 0.12 с")
    let p = flag(0)
    view.down(finger(f1, p)); view.move(finger(f1, CGPoint(x: p.x + 20, y: p.y), p0: p))
    XCTAssertEqual(view.state.trailCount(0), 0, "MOVE обнуляет след")
  }

  func testCornerHit() {
    XCTAssertTrue(view.cornerHit(CGFloat(G.W) - 10, 61 + 10))
    XCTAssertFalse(view.cornerHit(CGFloat(G.W) - 10, 50), "выше солнца")
    XCTAssertTrue(view.cornerHit(CGFloat(G.W) - 50, 62 + 0.5))
    XCTAssertFalse(view.cornerHit(CGFloat(G.W) - 60, 62 + 0.5), "дальше sun.r + 12")
  }

  func testLegend() {
    let L = view.legend
    XCTAssertEqual(L.map(\.glyph), [.tap, .up, .drag, .tap, .hold, .tap, .tap])
    XCTAssertEqual(L.map(\.gesture), ["tap the land", "drag a wanderer", "drag the rim of an orbit", "tap a wanderer", "hold a wanderer", "the dice", "tap the sun"])
    XCTAssertEqual(L.map(\.does), ["a wanderer · its orbit scans the hills — the sound",
                                   "north — higher, south — lower · the land under it — timbre",
                                   "wide — rich, small — almost a sine", "it leaves",
                                   "its sheet: octave, orbit, figure, path, range, level",
                                   "a new land and new paths", "map of worlds"])
    XCTAssertEqual(view.title, "Arcadia"); XCTAssertEqual(view.sub, "montes · lacus · flumina")
  }

  // ---------- кубик, корзина, отмена ----------
  func testDiceOrder() {
    build = { [unowned self] s in self.flat(s, lakeLeft: true) }
    setMirror([0: slot(0, 0), 1: slot(0.5, 0.5)])
    // seed, n; странник: (u, v) в озере → повтор → вне озера; r, fig, mode, sp, oct (fig: R ≥ 0.6 → 1 + ⌊R·2⌋)
    rngs = [0.5, 0.0,
            0.1, 0.5, 0.9, 0.5,  0.5, 0.7, 0.5, 0.5, 0.5, 0.1,
            0.9, 0.5,            0.0, 0.2, 0.0, 0.0, 0.9]
    view.dice()
    XCTAssertEqual(gone, [0, 1], "объекты до кубика — objGone")
    XCTAssertEqual(kinds(), [6, 5, 0, 0]); XCTAssertEqual(rec.acts[1].a, [Double(UInt32(0.5 * 2147483646))])
    XCTAssertEqual(rec.acts.map(\.i), [0, 0, 0, 1])
    let a0 = rec.acts[2].a, a1 = rec.acts[3].a
    XCTAssertEqual(a0[0], 0.9 * 1.6 - 0.8, accuracy: 1e-9); XCTAssertEqual(a0[1], 0.5 * 1.5 - 0.75, accuracy: 1e-9)
    XCTAssertEqual(a0[2], -1, "oct: R = 0.1 < 0.25"); XCTAssertEqual(a0[3], 0.08 + 0.5 * 0.3, accuracy: 1e-9); XCTAssertEqual(a0[4], 2)
    XCTAssertEqual(a0[5], 3); XCTAssertEqual(a0[6], 0.12 + 0.5 * 0.3, accuracy: 1e-9); XCTAssertEqual(a0[7], 0.8)
  }

  func testDiceAfterClear() {
    build = { [unowned self] s in self.flat(s) }
    setMirror([0: slot(-0.5, 0), 1: slot(0.5, 0)])
    rngs = [0.3, 0.5] + [Double](repeating: 0.5, count: 40)   // n = 3
    view.clear(); view.dice()
    XCTAssertEqual(kinds(), [1, 1, 6, 5, 0, 0, 0])
    XCTAssertEqual(rec.acts.suffix(3).map(\.i), [0, 1, 2], "слоты 0…n−1, без конфликтов")
    XCTAssertEqual(gone, [0, 1], "objGone — один раз на странника")
  }

  func testDiceStaleDiscarded() {                          // RF2
    let q = DispatchQueue(label: "arc.test")
    view = ArcadiaView(core: rec, readMirror: { [unowned self] b in
      let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
    }, rng: { [unowned self] in let r = self.rngs[self.rngAt]; self.rngAt += 1; return r },
       loader: ArcPicLoader(build: { [unowned self] s in self.flat(s) }, queue: q))
    setMirror()
    rngs = [0.1, 0.0, 0.6, 0.0] + [Double](repeating: 0.5, count: 20)
    view.dice(); view.dice()
    q.sync {}
    let e = expectation(description: "main"); DispatchQueue.main.async { e.fulfill() }
    wait(for: [e], timeout: 2)
    XCTAssertEqual(kinds().filter { $0 == 6 }.count, 1); XCTAssertEqual(kinds().filter { $0 == 5 }.count, 1)
    XCTAssertEqual(rec.acts.first { $0.kind == 5 }?.a, [Double(UInt32(0.6 * 2147483646))], "применён второй результат")
    XCTAssertEqual(view.pic?.seed, UInt32(0.6 * 2147483646))
  }

  func testDiceLostAddFreesSlot() {
    build = { [unowned self] s in self.flat(s) }
    setMirror(); rec.failAdd = true
    rngs = [0.3, 0.0] + [Double](repeating: 0.5, count: 40)
    view.dice()
    XCTAssertEqual(kinds(), [6, 5]); XCTAssertEqual(view.state.order, [])
  }

  func testPicLoadedBySeedChange() {
    build = { [unowned self] s in self.flat(s) }
    setMirror(seed: 42); XCTAssertEqual(view.pic?.seed, 42)
    setMirror(seed: 43); XCTAssertEqual(view.pic?.seed, 43)
  }

  func testClear() {
    setMirror([0: slot(-0.5, 0), 2: slot(0.5, 0)])
    view.clear()
    XCTAssertEqual(kinds(), [1, 1]); XCTAssertEqual(rec.acts.map(\.i), [0, 2]); XCTAssertEqual(gone, [0, 2])
  }

  func testRestoredResets() {                              // RF3
    let all: [Int: ArcSlot] = [0: slot(-0.5, 0), 1: slot(0.5, 0), 2: slot(-0.5, 0.5), 3: slot(0.5, 0.5)]
    setMirror(all)
    let p = flag(0)
    view.down(finger(f1, p)); view.move(finger(f1, CGPoint(x: p.x + 30, y: p.y), p0: p))
    view.down(finger(f2, flag(1)))
    rec.acts.removeAll(); gone.removeAll()
    XCTAssertNotEqual(view.value(0, key: 0), -0.5, "своё значение при тяге")
    view.restored()
    XCTAssertEqual(gone, [0, 1, 2, 3]); XCTAssertTrue(view.holds.isEmpty)
    XCTAssertEqual((0..<4).map { view.state.trailCount($0) }, [0, 0, 0, 0])
    XCTAssertEqual(view.value(0, key: 0), -0.5, "своих значений нет")
    view.up(finger(f1, p)); view.up(finger(f2, flag(1))); XCTAssertTrue(rec.acts.isEmpty, "up после undo ничего не шлёт")
    setMirror([2: slot(0, 0), 1: slot(0, 0.2)])
    XCTAssertEqual(view.state.order, [1, 2], "странники из зеркала — по возрастанию слота")
  }

  // ---------- плашки ----------
  private func sheetSlot() -> SheetSpec {
    var q = slot(0, 0); q.oct = -1; q.r = 0.315; q.fig = 2; q.mode = 4; q.sp = 0.3
    setMirror([1: q]); return view.viatorSpec(1)
  }
  private func setActs() -> [(kind: Int, i: Int, a: [Double], t: Double)] { rec.acts.filter { $0.kind == 3 } }

  func testViatorRows() {
    let sp = sheetSlot()
    XCTAssertEqual(sp.rows.map(\.code), [-1, 3, -1, -1, 6, 7])
    XCTAssertEqual(sp.rows.map(\.label), ["octave", "orbit", "figure", "path", "range", "level"])
    XCTAssertEqual(sp.lfo?.obj, 1); XCTAssertEqual(sp.lfo?.keys, ["r", "sp", "lvl"]); XCTAssertEqual(sp.lfo?.shape, 1)
    XCTAssertEqual(sp.obj, 1)
  }

  func testViatorGetSet() {
    let sp = sheetSlot()
    XCTAssertEqual(sp.get("oct"), 0, accuracy: 1e-9); XCTAssertEqual(sp.get("r"), 0.5, accuracy: 1e-9)
    XCTAssertEqual(sp.get("fig"), 1, accuracy: 1e-9); XCTAssertEqual(sp.get("mode"), 1, accuracy: 1e-9)
    XCTAssertEqual(sp.get("sp"), 0.5, accuracy: 1e-9); XCTAssertEqual(sp.get("lvl"), 0.8, accuracy: 1e-9)
    let cases: [(String, Double, [Double], Bool)] = [
      ("oct", 0.5, [2, 0], false), ("oct", 0, [2, -1], false), ("r", 0.5, [3, 0.315], false), ("fig", 0.5, [4, 1], false),
      ("mode", 0.75, [5, 3], true), ("sp", 0.5, [6, 0.3], false), ("lvl", 0.4, [7, 0.4], false)]
    for (k, v, a, route) in cases {
      rec.acts.removeAll(); sp.set(k, v)
      let x = setActs().last!
      XCTAssertEqual(x.i, 1); XCTAssertEqual(x.a.count, 3, k)
      XCTAssertEqual(x.a[0], a[0], k); XCTAssertEqual(x.a[1], a[1], accuracy: 1e-9, k); XCTAssertEqual(x.a[2], route ? 1 : 0, k)
    }
  }

  func testViatorText() {
    var q = slot(0, 0); q.oct = -1; q.r = 0.315; q.sp = 0.3
    setMirror([1: q]); let sp = view.viatorSpec(1)
    XCTAssertEqual(sp.text("oct"), "octave −1"); XCTAssertEqual(sp.text("r"), "32%")
    XCTAssertEqual(sp.text("sp"), "50%"); XCTAssertEqual(sp.text("lvl"), "80%")
    for (i, n) in ["circle", "eight", "knot"].enumerated() { q.fig = Double(i); setMirror([1: q]); XCTAssertEqual(view.viatorSpec(1).text("fig"), n) }
    for (i, n) in ["still", "circuit", "wander", "river", "summit"].enumerated() { q.mode = Double(i); setMirror([1: q]); XCTAssertEqual(view.viatorSpec(1).text("mode"), n) }
    q.oct = 0; setMirror([1: q]); XCTAssertEqual(view.viatorSpec(1).text("oct"), "octave 0")
    q.oct = 1; setMirror([1: q]); XCTAssertEqual(view.viatorSpec(1).text("oct"), "octave +1")
  }

  func testViatorOwnValues() {
    let sp = sheetSlot()
    sp.set("r", 0.5)
    XCTAssertEqual(sp.get("r"), 0.5, accuracy: 1e-9, "своё значение сразу")
    var q = slot(0, 0); q.r = 0.315
    setMirror([1: q])   // зеркало ещё старое — своё держится
    XCTAssertEqual(view.value(1, key: 3), 0.315, accuracy: 1e-9, "зеркало сошлось с 0.315 == своё, берёт верх")
  }

  func testViatorDeadSlot() {
    setMirror([0: slot(0, 0)])
    let sp = view.viatorSpec(2)
    rec.acts.removeAll(); sp.set("lvl", 0.3)
    XCTAssertTrue(setActs().isEmpty, "мёртвый слот — без действий")
    let sp0 = view.viatorSpec(0); gone.removeAll()
    setMirror([:])
    XCTAssertEqual(gone, [0]); _ = sp0
  }

  func testFanSheet() {
    setMirror()
    let sp = view.fxSpec
    XCTAssertEqual(sp.title, "aether"); XCTAssertEqual(sp.rows.map(\.code), [0, 1, 2, 3, 4, 6])
    XCTAssertEqual(sp.lfo?.obj, -1); XCTAssertEqual(sp.lfo?.shape, 1)
    XCTAssertEqual(sp.arc?() ?? -1, 0.4, accuracy: 1e-9)
    XCTAssertFalse(sp.rows.contains { $0.key == "spread" }); XCTAssertEqual(view.fxValue(5), 0.6, accuracy: 1e-9)
    rec.acts.removeAll(); sp.set("hall", 0.7); sp.set("pace", 0.2)
    XCTAssertEqual(rec.acts.map(\.kind), [4, 4]); XCTAssertEqual(rec.acts.map(\.i), [6, 1])
    XCTAssertEqual(rec.acts[0].a, [0.7]); XCTAssertEqual(rec.acts[1].a, [0.2])
    sp.set("pace", 0.35); XCTAssertEqual(sp.text("pace"), "27 s")
    sp.set("wind", 0); XCTAssertEqual(sp.text("wind"), "calm")
    sp.set("wind", 0.4); XCTAssertEqual(sp.text("wind"), "40%")
    sp.set("chorus", 0); XCTAssertEqual(sp.text("chorus"), "off")
    sp.set("phaser", 0.005); XCTAssertEqual(sp.text("phaser"), "off")
    sp.set("chorus", 0.35); XCTAssertEqual(sp.text("chorus"), "35%")
    sp.set("relief", 0.3); XCTAssertEqual(sp.text("relief"), "30%")
    sp.set("hall", 0.4); XCTAssertEqual(sp.text("hall"), "40%")
  }
}
