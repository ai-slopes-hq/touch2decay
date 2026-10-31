import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания, тление, плашки, веер и кубик Inferno (view.js:44-116, 249-266)
final class InfernoTests: XCTestCase {
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private let f1 = NSObject(), f2 = NSObject()
  private var opened: [SheetSpec] = []
  private lazy var view = InfernoView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, rng: { 0.5 })
  private var G: InfGeo { view.geo }

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало с грешниками на кругах sinners
  private func mirror(sinners: [Int] = []) -> [Double] {
    var b = [Double](repeating: 0, count: Inf.mirrorN)
    for k in 0..<Inf.nc {
      let o = Inf.head + k * Inf.circN
      b[o] = 0.5; b[o + 1] = sinners.contains(k) ? 1 : 0; b[o + 3] = Double(Inf.color0(k))
      b[o + 4] = 0.5; b[o + 5] = Inf.drive0(k); b[o + 6] = 0.7
    }
    return b
  }
  private func finger(_ o: NSObject, _ p: CGPoint, p0: CGPoint? = nil, t: Double = 0) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: 0, moved: false, touchTime: t)
  }
  private func at(_ k: Int, _ pos: Double) -> CGPoint { let p = G.at(k, pos); return CGPoint(x: p.x, y: p.y) }
  private func off(_ p: CGPoint, _ dx: CGFloat, _ dy: CGFloat = 0) -> CGPoint { CGPoint(x: p.x + dx, y: p.y + dy) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func circ(_ k: Int, now: Double = 1.0) -> InfCirc { view.state.circ(k, mirror: view.mirror, now: now) }

  func testTapStrikes() {
    let p = at(4, 0.3)
    view.down(finger(f1, p, t: 1)); view.up(finger(f1, p, t: 1.05))
    XCTAssertEqual(kinds(), [Inf.Act.pos, Inf.Act.strike])
    XCTAssertEqual(rec.acts[0].i, 4); XCTAssertEqual(rec.acts[0].a[0], G.posAt(4, Double(p.x)), accuracy: 1e-9)
    XCTAssertEqual(rec.acts[0].a[0], 0.3, accuracy: 1e-6)
    XCTAssertEqual(rec.acts[1].i, 4); XCTAssertEqual(rec.acts[1].a, [1])
    XCTAssertEqual(circ(4).lvl, 1, accuracy: 1e-9)
    XCTAssertEqual(circ(4).pos, 0.3, accuracy: 1e-6)
  }

  func testTapSinnerNoPos() {
    mirrorBuf = mirror(sinners: [6]); view.tick(now: 1.0, dt: 0.016)
    let p = at(6, 0.3)
    view.down(finger(f1, p, t: 1)); view.up(finger(f1, p, t: 1.05))
    XCTAssertEqual(kinds(), [Inf.Act.strike]); XCTAssertEqual(rec.acts[0].i, 6); XCTAssertEqual(rec.acts[0].a, [1])
    XCTAssertEqual(circ(6).pos, 0.5, accuracy: 1e-9)
  }

  func testDoubleTapPin() {
    let p = at(6, 0.4)
    view.down(finger(f1, p, t: 5.0)); view.up(finger(f1, p, t: 5.05))
    rec.acts.removeAll()
    view.down(finger(f1, p, t: 5.2))
    XCTAssertEqual(kinds(), [Inf.Act.pin]); XCTAssertEqual(rec.acts[0].i, 6)
    XCTAssertEqual(rec.acts[0].a[0], 0.4, accuracy: 1e-6)
    XCTAssertTrue(circ(6).sinner)
    XCTAssertEqual(circ(6).pos, 0.4, accuracy: 1e-6)
    view.up(finger(f1, p, t: 5.25))
    XCTAssertEqual(kinds().count, 1)                       // палец none — подъём молчит
    rec.acts.removeAll()
    view.down(finger(f1, p, t: 8.0)); view.up(finger(f1, p, t: 8.05))
    view.down(finger(f1, p, t: 8.4)); view.up(finger(f1, p, t: 8.45))
    XCTAssertEqual(kinds().filter { $0 == Inf.Act.strike }.count, 2)
    XCTAssertFalse(kinds().contains(Inf.Act.pin))
  }

  func testMissNothing() {
    let far = CGPoint(x: G.cx, y: G.rings[8].cy + G.dy)    // ниже последнего круга
    XCTAssertEqual(G.circleAt(Double(far.x), Double(far.y)), -1)
    let side = CGPoint(x: G.cx + G.rings[4].rx + 40, y: G.rings[4].cy)   // сбоку за краем круга
    XCTAssertEqual(G.circleAt(Double(side.x), Double(side.y)), -1)
    for p in [far, side, CGPoint(x: 100, y: 20)] {         // последняя — верхняя строка
      view.down(finger(f1, p, t: 1)); view.move(finger(f1, off(p, 30), p0: p, t: 1.1)); view.up(finger(f1, p, t: 1.2))
    }
    view.tick(now: 1.6, dt: 0.016)
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testSmoulder() {
    let p = at(2, 0.5)
    view.down(finger(f1, p, t: 1))
    view.tick(now: 1.15, dt: 0.016)
    XCTAssertEqual(kinds(), [Inf.Act.pos, Inf.Act.strike])
    view.tick(now: 1.17, dt: 0.016)
    XCTAssertEqual(kinds().last, Inf.Act.hold); XCTAssertEqual(rec.acts.last!.i, 2); XCTAssertEqual(rec.acts.last!.a, [1])
    view.tick(now: 1.30, dt: 0.016)
    XCTAssertEqual(kinds().filter { $0 == Inf.Act.hold }.count, 1)
    view.up(finger(f1, p, t: 1.4))
    XCTAssertEqual(kinds().last, Inf.Act.hold); XCTAssertEqual(rec.acts.last!.a, [-1])
    XCTAssertEqual(view.state.held(2), 0)
  }

  func testDragAlong() {
    let p = at(2, 0.5)
    view.down(finger(f1, p, t: 1))
    rec.acts.removeAll()
    view.move(finger(f1, off(p, 5), p0: p, t: 1.02))
    XCTAssertTrue(rec.acts.isEmpty)
    let q = off(p, 20)
    view.move(finger(f1, q, p0: p, t: 1.04))
    XCTAssertEqual(kinds(), [Inf.Act.hold, Inf.Act.pos])
    XCTAssertEqual(rec.acts[0].a, [1]); XCTAssertEqual(rec.acts[1].i, 2)
    XCTAssertEqual(rec.acts[1].a[0], G.posAt(2, Double(q.x)), accuracy: 1e-9)
    view.move(finger(f1, off(p, 30), p0: p, t: 1.06))
    XCTAssertEqual(kinds(), [Inf.Act.hold, Inf.Act.pos, Inf.Act.pos])
  }

  func testHarp() {
    let p0 = at(0, 0.5)
    view.down(finger(f1, p0, t: 1))
    rec.acts.removeAll()
    view.move(finger(f1, at(1, 0.5), p0: p0, t: 1.02))
    XCTAssertEqual(kinds(), [Inf.Act.pos, Inf.Act.strike])
    XCTAssertEqual(rec.acts[0].i, 1); XCTAssertEqual(rec.acts[1].i, 1); XCTAssertEqual(rec.acts[1].a, [0.8])
    view.move(finger(f1, at(3, 0.5), p0: p0, t: 1.04))
    XCTAssertEqual(kinds().suffix(2), [Inf.Act.pos, Inf.Act.strike]); XCTAssertEqual(rec.acts.last!.i, 3); XCTAssertEqual(rec.acts.last!.a, [0.8])
    let n = rec.acts.count
    view.move(finger(f1, off(at(3, 0.5), 40), p0: p0, t: 1.06))
    XCTAssertEqual(rec.acts.count, n)
    view.up(finger(f1, at(3, 0.9), p0: p0, t: 1.1))
    XCTAssertEqual(rec.acts.count, n)
    view.tick(now: 1.5, dt: 0.016)                         // в арфе тление не начинается
    XCTAssertEqual(rec.acts.count, n)
  }

  func testHarpFromSmoulder() {
    let p0 = at(0, 0.5)
    view.down(finger(f1, p0, t: 1))
    view.tick(now: 1.2, dt: 0.016)
    rec.acts.removeAll()
    view.move(finger(f1, at(1, 0.5), p0: p0, t: 1.22))
    XCTAssertEqual(kinds(), [Inf.Act.hold, Inf.Act.pos, Inf.Act.strike])
    XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[0].a, [-1])
    XCTAssertEqual(rec.acts[2].i, 1); XCTAssertEqual(rec.acts[2].a, [0.8])
    XCTAssertEqual(view.state.held(0), 0)
    view.tick(now: 1.5, dt: 0.016)
    XCTAssertFalse(kinds().dropFirst(3).contains(Inf.Act.hold))
    view.up(finger(f1, at(1, 0.5), p0: p0, t: 1.6))
    XCTAssertEqual(rec.acts.count, 3)
  }

  func testTwoFingersOneCircle() {
    let p = at(2, 0.5), q = at(2, 0.7)
    view.down(finger(f1, p, t: 1)); view.down(finger(f2, q, t: 1.5))   // второй палец позже двойного тапа
    view.tick(now: 1.2, dt: 0.016)
    XCTAssertEqual(rec.acts.filter { $0.kind == Inf.Act.hold && $0.a == [1] }.count, 2)
    XCTAssertEqual(view.state.held(2), 2)
    view.up(finger(f1, p, t: 1.3))
    XCTAssertEqual(rec.acts.last?.kind, Inf.Act.hold); XCTAssertEqual(rec.acts.last?.a, [-1])
    XCTAssertTrue(view.state.burning(2, mirror: view.mirror, now: 1.3))
    view.up(finger(f2, q, t: 1.4))
    XCTAssertEqual(rec.acts.filter { $0.kind == Inf.Act.hold && $0.a == [-1] }.count, 2)
    XCTAssertFalse(view.state.burning(2, mirror: view.mirror, now: 1.4))
  }

  func testHoldSinnerSheet() {
    mirrorBuf = mirror(sinners: [6]); view.tick(now: 1.0, dt: 0.016)
    view.down(finger(f1, at(6, 0.5), t: 1))
    view.tick(now: 1.43, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(opened.last?.title, "VII · Violentia")
    view.tick(now: 1.6, dt: 0.016)
    XCTAssertEqual(opened.count, 1)
    view.up(finger(f1, at(6, 0.5), t: 1.7))
    opened.removeAll()
    view.down(finger(f2, at(5, 0.5), t: 2)); view.tick(now: 2.5, dt: 0.016)   // не грешник
    XCTAssertTrue(opened.isEmpty)
    view.up(finger(f2, at(5, 0.5), t: 2.6))
    let p = at(6, 0.5)
    view.down(finger(f1, p, t: 3)); view.move(finger(f1, off(p, 12), p0: p, t: 3.1))
    view.tick(now: 3.43, dt: 0.016)
    XCTAssertTrue(opened.isEmpty)
  }

  func testCancel() {
    let p = at(2, 0.5)
    view.down(finger(f1, p, t: 1)); view.tick(now: 1.2, dt: 0.016)
    view.cancel(finger(f1, p, t: 1.3))
    XCTAssertEqual(rec.acts.last?.kind, Inf.Act.hold); XCTAssertEqual(rec.acts.last?.a, [-1])
    XCTAssertEqual(view.state.held(2), 0)
  }

  func testRestoredReleasesSmoulder() {
    let p = at(2, 0.5)
    view.down(finger(f1, p, t: 1)); view.tick(now: 1.2, dt: 0.016)
    view.restored()
    XCTAssertEqual(rec.acts.last?.kind, Inf.Act.hold); XCTAssertEqual(rec.acts.last?.i, 2); XCTAssertEqual(rec.acts.last?.a, [-1])
    let n = rec.acts.count
    view.move(finger(f1, off(p, 40), p0: p, t: 1.3)); view.up(finger(f1, p, t: 1.4))
    XCTAssertEqual(rec.acts.count, n)
    XCTAssertEqual(view.state.held(2), 0)
    view.down(finger(f1, p, t: 1.5)); view.up(finger(f1, p, t: 1.55))   // lastTap забыт: тап после restore — не двойной
    XCTAssertFalse(kinds().contains(Inf.Act.pin))
  }

  func testCircleSheetLfo() {
    let s = view.circleSpec(3)
    XCTAssertEqual(s.title, "IV · Avaritia"); XCTAssertEqual(s.hint, "circle — tap outside to close")
    XCTAssertEqual(s.rows.map(\.code), [0, -1, 1, 2, 3])
    XCTAssertEqual(s.rows.map(\.key), ["pos", "color", "width", "drive", "level"])
    XCTAssertEqual(s.lfo?.obj, 3); XCTAssertEqual(s.lfo?.shape, 0)
    XCTAssertEqual(s.lfo?.keys, ["pos", "width", "drive", "level"])
    s.set("width", 0.2)
    XCTAssertEqual(kinds(), [Inf.Act.circ]); XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [1, 0.2])
    XCTAssertEqual(s.get("width"), 0.2, accuracy: 1e-9)
    XCTAssertEqual(s.text("width"), "20%")
    s.set("color", 0.3)                                    // номер шума не сменился (у круга IV шум 1)
    XCTAssertEqual(rec.acts.count, 1)
    s.set("color", 0.5)
    XCTAssertEqual(rec.acts.count, 2); XCTAssertEqual(rec.acts[1].a, [4, 2])
    XCTAssertEqual(s.text("color"), "brown")
  }

  func testFan() {
    let s = view.fx!
    XCTAssertEqual(s.title, "aether"); XCTAssertEqual(s.hint, "FX — tap outside to close")
    XCTAssertEqual(s.rows.map(\.code), [0, 1, 2, 3, 4])
    XCTAssertEqual(s.rows.map(\.key), Inf.fxKeys)
    XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.shape, 0)
    XCTAssertEqual(s.lfo?.keys, Set(Inf.fxKeys))
    s.set("ice", 0.7)
    XCTAssertEqual(kinds(), [Inf.Act.fx]); XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [0.7])
    XCTAssertEqual(s.get("ice"), 0.7, accuracy: 1e-9)
    XCTAssertEqual(s.arc?(), view.state.fx(2, mirror: view.mirror, now: 1.0))
    XCTAssertEqual(s.text("structure"), "harmonic")
  }

  func testHeardSparks() {
    heardQ = [[2, 4, 7]]
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(view.state.sparkCount, 20)
    heardQ = [[1, 3]]
    view.idle()
    XCTAssertTrue(heardQ.isEmpty)
    XCTAssertEqual(view.state.sparkCount, 20)
  }

  func testDiceClear() {
    mirrorBuf = mirror(sinners: [6]); view.tick(now: 1.0, dt: 0.016)
    view.dice()
    XCTAssertEqual(kinds(), [Inf.Act.dice])
    XCTAssertFalse(circ(6, now: 1.1).sinner)
    view.clear()
    XCTAssertEqual(kinds(), [Inf.Act.dice, Inf.Act.clear])
    XCTAssertFalse(circ(6, now: 1.2).sinner)
    XCTAssertTrue(circ(6, now: 1.3).sinner)                // 0.25 с прошло — снова зеркало
  }

  func testCorner() {
    XCTAssertTrue(view.cornerHit(20, 790))
    XCTAssertFalse(view.cornerHit(120, 810))
    XCTAssertEqual(view.objs, 9)
  }

  func testHoldShot() {
    view.holdShot(3, pos: 0.25)
    XCTAssertEqual(kinds(), [Inf.Act.pos, Inf.Act.hold])
    XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [0.25])
    XCTAssertTrue(view.isHeld(3)); XCTAssertFalse(view.isHeld(4))
    XCTAssertEqual(view.state.held(3), 1)
  }

  // ---------- рисование ----------
  func testWallKey() {
    let w = InfWall(), g1 = InfGeo(W: 390, H: 844, topY: 59, safeBot: 34), g2 = InfGeo(W: 390, H: 800, topY: 59, safeBot: 34)
    _ = w.image(g1, dpr: 1) { _ in }; _ = w.image(g1, dpr: 1) { _ in }
    XCTAssertEqual(w.builds, 1)
    _ = w.image(g2, dpr: 1) { _ in }
    XCTAssertEqual(w.builds, 2)
    _ = w.image(g2, dpr: 2) { _ in }
    XCTAssertEqual(w.builds, 3)
  }

  func testDrawSmoke() {
    var b = mirror(sinners: [1, 6])
    for k in 1...3 { b[Inf.head + k * Inf.circN + 7] = 0.8 }
    b[1] = 0.6; b[2] = 0.4                                // iceE, stormSemi
    mirrorBuf = b; view.tick(now: 2.0, dt: 0.016)
    heardQ = [[4, 0, 1, 2, 3], [4, 4, 5, 6, 7]]; view.tick(now: 2.1, dt: 0.016)   // угольки: по 10 на удар
    for n in 1...3 { heardQ = [[4, 0, 1, 2, 3]]; view.tick(now: 2.1 + Double(n) * 0.016, dt: 0.016) }
    XCTAssertGreaterThan(view.state.sparkCount, 30)
    view.holdShot(2, pos: 0.8)
    let W = 390, H = 844
    let g = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    g.translateBy(x: 0, y: CGFloat(H)); g.scaleBy(x: 1, y: -1)
    let d = Draw(g: g, W: CGFloat(W), H: CGFloat(H)); d.setTheme(view.theme)
    view.draw(d, now: 2.2)
    let px = Array(UnsafeBufferPointer(start: g.data!.assumingMemoryBound(to: UInt8.self), count: W * H * 4))
    func lit(_ cy: Double, _ ry: Double) -> Int {          // пиксели заметно ярче фона 5,4,3 в полосе вокруг круга
      var n = 0
      for y in Int(cy - ry - 4)...Int(cy + ry + 4) { for x in 0..<W { let o = (y * W + x) * 4; if Int(px[o]) + Int(px[o + 1]) + Int(px[o + 2]) > 60 { n += 1 } } }
      return n
    }
    XCTAssertGreaterThan(lit(G.rings[3].cy, G.rings[3].ry), 50, "круг IV нарисован")
    XCTAssertGreaterThan(lit(G.coc.cy, G.coc.ry), 50, "Коцит нарисован")
    view.drawShot(d, now: 2.2)
    XCTAssertEqual(view.wall.builds, 1)
  }
}
