import XCTest
@testable import T2D

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания Portus: вода, кораблики, вехи, маяк, луна, буй, туман, небо (view.js:54-106, 144-146)
final class PorTouchTests: XCTestCase {
  private typealias A = Por.Act
  private typealias P = (x: Double, y: Double)
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private lazy var view = PortusView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, rng: { 0.5 })
  private var opened: [SheetSpec] = []
  private var maps = 0
  private let f1 = NSObject(), f2 = NSObject(), f3 = NSObject()

  override func setUp() {
    mirrorBuf = mirror()
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    view.goMap = { [unowned self] in self.maps += 1 }
    view.tick(now: 1.0, dt: 0.016)
  }

  private var G: PorGeo { view.geo }
  private func F(_ o: NSObject, _ p: P) -> Finger {
    let x = CGFloat(p.x), y = CGFloat(p.y)
    return Finger(id: ObjectIdentifier(o), x: x, y: y, x0: x, y0: y, t0: 0, moved: false, touchTime: 0)
  }
  private func at(_ dt: Double) { view.tick(now: view.now + dt, dt: dt) }
  private func tap(_ o: NSObject, _ p: P) { view.down(F(o, p)); view.up(F(o, p)) }
  private func sp(_ i: Int, _ p: Double) -> P { let q = G.slotPt(i, p); return (q.x, q.y) }
  private func off(_ p: P, _ dx: Double, _ dy: Double = 0) -> P { (p.x + dx, p.y + dy) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func count(_ k: Int) -> Int { rec.acts.filter { $0.kind == k }.count }
  private func load(on: [Int: Double] = [:], playing: Bool = false) {
    mirrorBuf = mirror(on: on, playing: playing); view.tick(now: view.now + 0.001, dt: 0.001)
  }
  private func mirror(on: [Int: Double] = [:], playing: Bool = false) -> [Double] {
    let m = PorMirror()
    var b = [Double](repeating: 0, count: Por.mirrorN)
    b[0] = playing ? 0 : -1; b[1] = playing ? 1 : 0; b[3] = m.bpm
    for k in 0..<3 { b[4 + k] = m.luna[k]; b[7 + k] = m.echo[k] }
    b[10] = m.buoy.u; b[11] = m.buoy.d
    for k in 0..<2 { b[12 + k] = m.fog[k] }
    for k in 0..<5 { b[14 + k] = m.pharos[k]; b[19 + k] = m.fx[k] }
    for (j, p) in on { let o = Por.head + j * Por.isleN; b[o] = 1; b[o + 1] = p; b[o + 3] = 1 }
    return b
  }
  // точка, где markAt даёт веху i (метки соседних шагов перекрываются: ищем по высоте)
  private func markTouch(_ i: Int) -> P {
    let m = G.markPt(i)
    for dy in stride(from: 3.0, through: -40.0, by: -1) where view.markAt(m.x, m.y + dy) == i { return (m.x, m.y + dy) }
    XCTFail("веха \(i) недосягаема"); return (m.x, m.y)
  }

  func testTapWaterPlaces() {
    tap(f1, sp(5, 7))
    XCTAssertEqual(kinds(), [A.place, A.audition])
    XCTAssertEqual(rec.acts[0].i, 5); XCTAssertEqual(rec.acts[0].a, [7, 500]); XCTAssertEqual(rec.acts[1].i, 5)
    XCTAssertEqual(count(A.sink), 0)                         // fresh: тап по свежему не топит
    rec.acts.removeAll(); at(0.1)
    tap(f2, sp(6, 3))
    XCTAssertEqual(kinds(), [A.place])                       // аудиция не чаще 0.14 с
    XCTAssertEqual(rec.acts[0].i, 6); XCTAssertEqual(rec.acts[0].a, [3, 500])
    rec.acts.removeAll(); at(1.0); load(playing: true)
    tap(f3, sp(9, 5))
    XCTAssertEqual(kinds(), [A.place])                       // играет — без аудиции
    XCTAssertEqual(view.lastP, 5)
  }

  func testTapIsleSinks() {
    load(on: [5: 6])
    tap(f1, sp(5, 6))
    XCTAssertEqual(kinds(), [A.sink]); XCTAssertEqual(rec.acts[0].i, 5)
    rec.acts.removeAll(); load(on: [5: 6]); at(0.5)
    view.down(F(f1, sp(5, 6))); at(0.43)
    XCTAssertEqual(opened.map(\.title), ["navicula"])
    view.up(F(f1, sp(5, 6)))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testDragIsleNote() {
    load(on: [5: 6])
    view.down(F(f1, sp(5, 6)))
    view.move(F(f1, off(sp(5, 6), 5)))                       // < 8 px — ничего
    XCTAssertTrue(rec.acts.isEmpty)
    view.move(F(f1, sp(5, 10)))
    XCTAssertEqual(kinds(), [A.note, A.audition])
    XCTAssertEqual(rec.acts[0].i, 5); XCTAssertEqual(rec.acts[0].a, [10]); XCTAssertEqual(rec.acts[1].i, 5)
    view.up(F(f1, sp(5, 10)))
    XCTAssertEqual(count(A.sink), 0)
  }

  func testMoveSkipsBusy() {
    load(on: [3: 6, 5: 6])
    view.down(F(f1, sp(3, 6)))
    view.move(F(f1, sp(5, 6)))                               // 5 занято
    XCTAssertEqual(count(A.move), 0)
    view.move(F(f1, sp(7, 6)))
    XCTAssertEqual(rec.acts.filter { $0.kind == A.move }.map { [Double($0.i)] + $0.a }, [[3, 7]])
    view.move(F(f1, sp(7, 9)))
    XCTAssertEqual(rec.acts.last?.kind, A.audition)
    let n = rec.acts.filter { $0.kind == A.note }
    XCTAssertEqual(n.map(\.i), [7]); XCTAssertEqual(n[0].a, [9])
    XCTAssertTrue(view.isle(5).on)
    XCTAssertTrue(view.isle(7).on); XCTAssertFalse(view.isle(3).on)
  }

  func testMarker() {
    let m = markTouch(2)
    tap(f1, m)
    XCTAssertEqual(kinds(), [A.place, A.audition])
    XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[0].a, [Double(view.lastP), 500])
    rec.acts.removeAll()
    tap(f1, m)
    XCTAssertEqual(kinds(), [A.sink]); XCTAssertEqual(rec.acts[0].i, 2)
  }

  func testPharos() {
    let ph: P = (G.ph.x, G.ph.y - 10)
    tap(f1, ph)
    XCTAssertEqual(kinds(), [A.play]); XCTAssertEqual(rec.acts[0].a, [1])
    rec.acts.removeAll()
    view.down(F(f2, ph)); view.move(F(f2, off(ph, 40)))
    XCTAssertEqual(kinds(), [A.bpm]); XCTAssertEqual(rec.acts[0].a, [140])
    view.move(F(f2, off(ph, 40)))                            // тот же bpm — не шлём
    view.up(F(f2, off(ph, 40)))
    XCTAssertEqual(kinds(), [A.bpm])
    view.down(F(f3, ph)); at(0.43)
    XCTAssertEqual(opened.map(\.title), ["pharos"])
  }

  func testMoonTapDragHold() {
    let M = G.moon, p: P = (M.x + 10, M.y)
    view.down(F(f1, p)); at(0.1); view.up(F(f1, p))
    XCTAssertEqual(maps, 1); XCTAssertTrue(rec.acts.isEmpty)
    view.down(F(f1, p)); view.move(F(f1, off(p, 0, -50)))
    let l0 = rec.acts.last { $0.kind == A.luna && $0.i == 0 }
    XCTAssertEqual(l0?.a[0] ?? -1, 0.42 + 50 / (279.8 - 56 - 41.4), accuracy: 1e-9)
    view.up(F(f1, off(p, 0, -50)))
    XCTAssertEqual(maps, 1)
    rec.acts.removeAll()
    view.down(F(f2, p)); view.move(F(f2, off(p, 39)))
    let l1 = rec.acts.last { $0.kind == A.luna && $0.i == 1 }
    XCTAssertEqual(l1?.a[0] ?? -1, 0.35 + 39 / 195, accuracy: 1e-9)
    view.up(F(f2, off(p, 39)))
    XCTAssertEqual(maps, 1)
    view.down(F(f3, p)); at(0.43); view.up(F(f3, p))
    XCTAssertEqual(opened.map(\.title), ["luna"]); XCTAssertEqual(maps, 1)
  }

  func testBuoyFogSky() {
    let B = G.P(0.35, 0.45), b: P = (B.x, B.y - 8)
    view.down(F(f1, b))
    let far: P = (380, b.y)
    view.move(F(f1, far))
    let u = G.unP(far.x, min(max(far.y, G.hor + 6), G.qy - 10))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, A.buoy); XCTAssertEqual(rec.acts[0].i, 0)
    XCTAssertEqual(rec.acts[0].a, [u.u, u.d])                // сырые, без зажима porBuoy
    XCTAssertNotEqual(rec.acts[0].a[0], porBuoy(u: u.u, d: u.d).u)
    view.up(F(f1, far))
    rec.acts.removeAll(); load()
    let fg: P = (250, G.fogTop)
    view.down(F(f2, fg)); view.move(F(f2, off(fg, 0, -30)))
    XCTAssertEqual(kinds(), [A.fog])
    XCTAssertEqual(rec.acts[0].a[0], 0.45 + 30 / (0.7 * (279.8 - 56 - 40)), accuracy: 1e-9)
    view.up(F(f2, off(fg, 0, -30)))
    rec.acts.removeAll()
    tap(f3, (195, 120))
    XCTAssertEqual(kinds(), [A.kill]); XCTAssertEqual(view.state.killAt, view.now)
    let bb = G.P(view.buoy.u, view.buoy.d)
    view.down(F(f1, (bb.x, bb.y - 8))); at(0.43)
    view.down(F(f2, fg)); at(0.43)
    XCTAssertEqual(opened.map(\.title), ["echo", "nebula"])
  }

  func testTwoFingers() {
    load(on: [0: 6, 8: 6])
    view.down(F(f1, sp(0, 6))); view.down(F(f2, sp(8, 6)))
    view.move(F(f1, sp(0, 10))); view.move(F(f2, sp(8, 2)))
    let n = rec.acts.filter { $0.kind == A.note }
    XCTAssertEqual(n.map(\.i), [0, 8]); XCTAssertEqual(n.map(\.a), [[10], [2]])
  }

  func testRestoredMidGesture() {
    load(on: [5: 6])
    let M = G.moon, B = G.P(0.35, 0.45)
    view.down(F(f1, sp(5, 6))); view.down(F(f2, (M.x + 10, M.y))); view.down(F(f3, (B.x, B.y - 8)))
    view.restored()
    for (o, p) in [(f1, sp(5, 10)), (f2, (M.x + 10, M.y - 50)), (f3, (380.0, B.y))] as [(NSObject, P)] {
      view.move(F(o, p)); view.up(F(o, p))
    }
    XCTAssertTrue(rec.acts.isEmpty); XCTAssertEqual(maps, 0)
  }

  func testCancel() {
    load(on: [5: 6])
    let M = G.moon
    view.down(F(f1, (M.x + 10, M.y))); view.cancel(F(f1, (M.x + 10, M.y))); view.up(F(f1, (M.x + 10, M.y)))
    XCTAssertEqual(maps, 0)
    view.down(F(f2, sp(5, 6))); view.cancel(F(f2, sp(5, 6))); view.up(F(f2, sp(5, 6)))
    XCTAssertTrue(rec.acts.isEmpty)
  }
}
