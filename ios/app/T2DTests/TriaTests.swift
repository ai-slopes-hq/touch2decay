import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания, плашки, веер и кубик Tria (view.js:26-77, 177-187)
final class TriaTests: XCTestCase {
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private var rngVal = 0.5
  private let f1 = NSObject(), f2 = NSObject()
  private var opened: [SheetSpec] = []
  private lazy var view = TriaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, rng: { [unowned self] in self.rngVal })
  private var G: TriaGeo { view.geo }

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    mirrorBuf = mirror()
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало: тела в rest(), still 1
  private func mirror(m: Double = 1, still: Double = 1) -> [Double] {
    var b = [Double](repeating: 0, count: Tria.mirrorN)
    b[6] = still
    for i in 0..<Tria.nb {
      let o = Tria.head + i * Tria.bodyM, p = Tria.rest(i)
      b[o] = p.x; b[o + 1] = p.y; b[o + 4] = m; b[o + 7] = 0.8; b[o + 9] = 110
    }
    return b
  }
  private func finger(_ o: NSObject, _ p: CGPoint, p0: CGPoint? = nil, t: Double = 0) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: 0, moved: false, touchTime: t)
  }
  private func bp(_ i: Int) -> CGPoint { G.px(Tria.rest(i).x, Tria.rest(i).y) }
  private func off(_ p: CGPoint, _ dx: CGFloat, _ dy: CGFloat = 0) -> CGPoint { CGPoint(x: p.x + dx, y: p.y + dy) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }

  func testAvatarOpensSheet() {
    let p = CGPoint(x: G.av[2].x, y: G.av[2].y)
    view.down(finger(f1, p)); view.up(finger(f1, p))
    XCTAssertEqual(opened.last?.title, "Mercurius")
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testPlumb() {
    let p = CGPoint(x: G.plumb.x, y: G.plumb.y)
    view.down(finger(f1, p))
    XCTAssertEqual(kinds(), [Tria.Act.plumb])
    XCTAssertTrue(view.state.flags(mirror: view.mirror, now: 1.0).cadit)
  }

  func testGrabDragThrow() {
    let p0 = bp(0)
    view.down(finger(f1, p0, t: 10.0))
    XCTAssertEqual(kinds(), [Tria.Act.grab]); XCTAssertEqual(rec.acts[0].i, 0)
    view.move(finger(f1, off(p0, 5), p0: p0, t: 10.05))
    XCTAssertEqual(rec.acts.count, 1)                      // сдвиг ≤ 8 — не тяга
    let p1 = off(p0, 40), p2 = off(p0, 140)
    view.move(finger(f1, p1, p0: p0, t: 10.10))
    XCTAssertEqual(rec.acts.count, 2)
    XCTAssertEqual(rec.acts[1].kind, Tria.Act.drag); XCTAssertEqual(rec.acts[1].i, 0)
    XCTAssertLessThanOrEqual(hypot(rec.acts[1].a[0], rec.acts[1].a[1]), 0.95 + 1e-9)
    view.tick(now: 1.1, dt: 0.1)                           // зеркало в rest(), а тело — в руке
    let u = G.unit(p1)
    XCTAssertEqual(view.state.pos(0, mirror: view.mirror).x, u.x, accuracy: 1e-9)
    view.move(finger(f1, p2, p0: p0, t: 10.20))
    view.up(finger(f1, p2, p0: p0, t: 10.30))
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.release); XCTAssertEqual(rec.acts.last?.i, 0)
    // история: [10.0 p0, 10.10 p1, 10.20 p2] (сдвиг 5 px в историю не попал); Δt = 200 мс
    let dtm = 200.0, vx = min(3, max(-3, (140.0 / Double(G.R)) / dtm * 1000 * 0.5))
    XCTAssertEqual(rec.acts.last!.a.count, 2)
    XCTAssertEqual(rec.acts.last!.a[0], vx, accuracy: 1e-9); XCTAssertEqual(rec.acts.last!.a[1], 0, accuracy: 1e-9)
    XCTAssertFalse(view.isHeld(0))
    XCTAssertEqual(view.state.pos(0, mirror: view.mirror).x, Tria.rest(0).x, accuracy: 1e-9)   // по зеркалу
    XCTAssertFalse(view.state.flags(mirror: view.mirror, now: 1.1).still)
  }

  func testDragClamp() {
    let p0 = bp(0)
    view.down(finger(f1, p0, t: 1)); view.move(finger(f1, CGPoint(x: G.cx + 3000, y: G.cy), p0: p0, t: 1.1))
    let a = rec.acts.last!.a
    XCTAssertEqual(hypot(a[0], a[1]), 0.95, accuracy: 1e-9)
  }

  func testTap() {
    let p = bp(1)
    view.down(finger(f1, p, t: 1)); view.up(finger(f1, p, t: 1.1))
    XCTAssertEqual(kinds(), [Tria.Act.grab, Tria.Act.release])
    XCTAssertEqual(rec.acts[1].i, 1); XCTAssertEqual(rec.acts[1].a, [])
  }

  func testDoubleTapAnchor() {
    let p = bp(1)
    view.down(finger(f1, p, t: 5.0)); view.up(finger(f1, p, t: 5.05))
    view.down(finger(f1, p, t: 5.2))
    XCTAssertEqual(kinds(), [Tria.Act.grab, Tria.Act.release, Tria.Act.anchor]); XCTAssertEqual(rec.acts[2].i, 1)
    view.up(finger(f1, p, t: 5.25))
    XCTAssertEqual(kinds().count, 3)                       // палец none — подъём молчит
    rec.acts.removeAll()
    view.down(finger(f1, p, t: 8.0)); view.up(finger(f1, p, t: 8.05))
    view.down(finger(f1, p, t: 8.4))
    XCTAssertEqual(kinds().filter { $0 == Tria.Act.grab }.count, 2)
    XCTAssertFalse(kinds().contains(Tria.Act.anchor))
  }

  func testHoldOpensSheetOnce() {
    let p = bp(2)
    view.down(finger(f1, p, t: 1))
    view.tick(now: 1.43, dt: 0.016)
    XCTAssertEqual(kinds(), [Tria.Act.grab, Tria.Act.drop]); XCTAssertEqual(rec.acts[1].i, 2)
    XCTAssertEqual(opened.map(\.title), ["Mercurius"])
    view.tick(now: 1.5, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(rec.acts.count, 2)
    view.up(finger(f1, p, t: 1.6))
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.release); XCTAssertEqual(rec.acts.last?.i, 2); XCTAssertEqual(rec.acts.last?.a, [])
    XCTAssertEqual(opened.count, 1)
  }

  func testLux() {
    let c = CGPoint(x: G.cx, y: G.cy)
    view.down(finger(f1, c)); view.up(finger(f1, c))
    XCTAssertEqual(kinds(), [Tria.Act.lux])
    XCTAssertTrue(view.state.flags(mirror: view.mirror, now: 1.0).lux)
    rec.acts.removeAll()
    view.down(finger(f1, off(c, 30))); view.up(finger(f1, off(c, 30)))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testTwoFingersTwoBodies() {
    let p0 = bp(0), p1 = bp(1)
    view.down(finger(f1, p0, t: 1)); view.down(finger(f2, p1, t: 1))
    view.move(finger(f1, off(p0, 30), p0: p0, t: 1.1)); view.move(finger(f2, off(p1, -30), p0: p1, t: 1.1))
    XCTAssertEqual(rec.acts.filter { $0.kind == Tria.Act.drag }.map(\.i), [0, 1])
    view.up(finger(f1, off(p0, 30), p0: p0, t: 1.2))
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.release); XCTAssertEqual(rec.acts.last?.i, 0)
    XCTAssertTrue(view.isHeld(1)); XCTAssertFalse(view.isHeld(0))
    view.move(finger(f2, off(p1, -60), p0: p1, t: 1.3))
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.drag); XCTAssertEqual(rec.acts.last?.i, 1)
  }

  func testCancelReleases() {
    let p0 = bp(0)
    view.down(finger(f1, p0, t: 1)); view.move(finger(f1, off(p0, 40), p0: p0, t: 1.1))
    let n = rec.acts.count
    view.cancel(finger(f1, off(p0, 40), p0: p0, t: 1.2))
    XCTAssertEqual(rec.acts.count, n + 1)
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.release); XCTAssertEqual(rec.acts.last?.a, [])
    XCTAssertTrue(opened.isEmpty); XCTAssertFalse(view.isHeld(0))
  }

  func testRestoredDropsFinger() {
    let p0 = bp(0)
    view.down(finger(f1, p0, t: 1)); view.move(finger(f1, off(p0, 40), p0: p0, t: 1.1))
    mirrorBuf = mirror(still: 0)
    heardQ = [[1, 0, 1, 0, 0, 1]]
    view.tick(now: 1.2, dt: 0.1)
    XCTAssertEqual(view.state.flashCount, 1)
    view.restored()
    let n = rec.acts.count
    view.move(finger(f1, off(p0, 80), p0: p0, t: 1.3)); view.up(finger(f1, off(p0, 80), p0: p0, t: 1.4))
    XCTAssertEqual(rec.acts.count, n)
    XCTAssertFalse(view.isHeld(0))
    XCTAssertEqual(view.state.flashCount, 0)
    for i in 0..<Tria.nb { XCTAssertEqual(view.state.trailCount(i), 0) }
    XCTAssertEqual(view.state.pos(0, mirror: view.mirror).x, Tria.rest(0).x, accuracy: 1e-9)
  }

  func testSheetOwnValues() {
    let s = view.bodySpec(0)
    s.set("m", 1)
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.set); XCTAssertEqual(rec.acts.last?.i, 0); XCTAssertEqual(rec.acts.last?.a, [0, 1])
    XCTAssertEqual(s.get("m"), 1, accuracy: 1e-9)          // своё значение, зеркало ещё m 1
    view.tick(now: 1.26, dt: 0.26)
    XCTAssertEqual(s.get("m"), (1 - 0.3) / 2.7, accuracy: 1e-9)
    XCTAssertEqual(s.rows.map(\.key), ["m", "semi", "level", "fixed"]); XCTAssertNil(s.lfo)
    XCTAssertEqual(s.rows.last?.code, -1)
  }

  func testFanLfoCodes() {
    let f = view.fx!
    XCTAssertEqual(f.rows.map(\.code), [0, 1, 2, 3, 4, 5])
    XCTAssertEqual(f.rows.map(\.key), Tria.fxKeys)
    XCTAssertEqual(f.lfo?.obj, -1); XCTAssertEqual(f.lfo?.shape, 1); XCTAssertEqual(f.lfo?.keys, Set(Tria.fxKeys))
    XCTAssertEqual(f.title, "aether")
    f.set("hall", 0.7)
    XCTAssertEqual(rec.acts.last?.kind, Tria.Act.fx); XCTAssertEqual(rec.acts.last?.i, 5); XCTAssertEqual(rec.acts.last?.a, [0.7])
    XCTAssertEqual(f.get("hall"), 0.7, accuracy: 1e-9)
    XCTAssertEqual(f.arc?(), 0.7)
  }

  func testDiceAction() {
    view.dice()
    XCTAssertEqual(kinds(), [Tria.Act.dice])
    XCTAssertEqual(rec.acts[0].a, triaDice { 0.5 }); XCTAssertEqual(rec.acts[0].a.count, 18)
    let fl = view.state.flags(mirror: view.mirror, now: 1.0)
    XCTAssertFalse(fl.still); XCTAssertFalse(fl.lux); XCTAssertFalse(fl.cadit)
  }

  func testClear() {
    view.clear()
    XCTAssertEqual(kinds(), [Tria.Act.clear])
    XCTAssertTrue(view.state.flags(mirror: view.mirror, now: 1.0).still)
  }

  func testHeardFlashes() {
    heardQ = [[2, 0, 0, 0.1, 0.2, 1, 1, 1, 0.3, 0.4, 1]]
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(view.state.flashCount, 2)
    heardQ = [[1, 2, 0, 0, 0, 1]]
    view.idle()
    XCTAssertEqual(view.state.flashCount, 2); XCTAssertTrue(heardQ.isEmpty)
  }

  func testCorner() {
    XCTAssertTrue(view.cornerHit(10, 60))
    XCTAssertFalse(view.cornerHit(10, 40))
  }

  func testMeta() {
    XCTAssertEqual(view.title, "Tria corpora"); XCTAssertEqual(view.sub, "sal · sulphur · mercurius")
    XCTAssertEqual(view.legend.map(\.glyph), [.throw, .double, .hold, .tap, .tap, .tap])
    XCTAssertEqual(view.objs, 3)
  }

  // ---------- рисование ----------
  func testWallKey() {
    let w = TriaWall(), g1 = TriaGeo(W: 390, H: 844, topY: 59, safeBot: 34), g2 = TriaGeo(W: 390, H: 800, topY: 59, safeBot: 34)
    _ = w.image(g1, dpr: 1) { _ in }; _ = w.image(g1, dpr: 1) { _ in }
    XCTAssertEqual(w.builds, 1)
    _ = w.image(g2, dpr: 1) { _ in }
    XCTAssertEqual(w.builds, 2)
    _ = w.image(g2, dpr: 2) { _ in }
    XCTAssertEqual(w.builds, 3)
  }

  func testDrawSmoke() {
    var b = mirror(still: 0); b[7] = 1; b[Tria.head + 5] = 1; b[Tria.head + 8] = 0.6   // lux, тело 0 на якоре
    b[2] = 0.5                                          // nexus
    mirrorBuf = b; view.tick(now: 2.0, dt: 0.016)
    var rec: [Double] = [12]
    for i in 0..<Tria.nb { for kind in 0...3 { rec += [Double(i), Double(kind), 0.3, -0.2, 0.5] } }
    for k in 1...50 { view.tick(now: 2.0 + Double(k) * 0.02, dt: 0.02) }
    heardQ = [rec]; view.tick(now: 3.05, dt: 0.016)
    XCTAssertGreaterThan(view.state.trailCount(0), 10); XCTAssertEqual(view.state.flashCount, 12)
    view.holdShot(0)
    let W = 390, H = 844
    let g = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    g.translateBy(x: 0, y: CGFloat(H)); g.scaleBy(x: 1, y: -1)
    let d = Draw(g: g, W: CGFloat(W), H: CGFloat(H)); d.setTheme(view.theme)
    view.draw(d, now: 3.1)
    let px = Array(UnsafeBufferPointer(start: g.data!.assumingMemoryBound(to: UInt8.self), count: W * H * 4))
    var n = 0
    let cx = Int(G.cx), cy = Int(G.cy)
    for y in (cy - 40)..<(cy + 40) { for x in (cx - 40)..<(cx + 40) { let o = (y * W + x) * 4; n += Int(px[o]) + Int(px[o + 1]) + Int(px[o + 2]) } }
    XCTAssertGreaterThan(n, 80 * 80 * (19 + 15 + 10) + 500, "в центре блюда есть чернила поверх фона")
    view.drawShot(d, now: 3.1)
    XCTAssertEqual(view.wall.builds, 1)
  }
}
