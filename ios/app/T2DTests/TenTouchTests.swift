import XCTest
@testable import T2D

private final class TTRec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания поля Tenebrae: палец, тяга, солнце, двойной тап, удержание, щипок зума (app.js:393-502)
final class TenTouchTests: XCTestCase {
  private let rec = TTRec()
  private var mbuf: [Double] = []
  private lazy var view = TenebraeView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mbuf.count, b.count); b.replaceSubrange(0..<n, with: self.mbuf[0..<n]); return n
  }, readHeard: { _ in 0 }, readLevel: { 0 }, rng: { 0.5 })
  private let bot = 806.0                                  // 844 − 34 − 4
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
  private func put(_ m: inout [Double], _ i: Int, active: Bool = true, pinned: Bool = false, held: Bool = false,
                   x: Double = 0.4, y: Double = 0.5) {
    let o = Ten.head + Ten.voiceN * i
    m[o] = active ? 1 : 0; m[o + 1] = active ? 1 : 0; m[o + 2] = pinned ? 1 : 0; m[o + 3] = held ? 1 : 0
    m[o + 4] = x; m[o + 5] = y; m[o + 6] = 0.35; m[o + 15] = 1; m[o + 16] = 1
  }
  private func load(_ e: @escaping (inout [Double]) -> Void) { mbuf = mirror(e) }
  private func tick(_ t: Double) { view.tick(now: t, dt: 0.016) }
  private func fing(_ id: NSObject, _ x: Double, _ y: Double, t0: Double, x0: Double? = nil, y0: Double? = nil, tt: Double = 0) -> Finger {
    Finger(id: ObjectIdentifier(id), x: x, y: y, x0: x0 ?? x, y0: y0 ?? y, t0: t0, moved: false, touchTime: tt == 0 ? t0 : tt)
  }
  private var log: [(kind: Int, i: Int, a: [Double], t: Double)] { rec.acts.filter { $0.kind != Act.sun } }
  private func has(_ kind: Int, _ i: Int? = nil) -> Bool { rec.acts.contains { $0.kind == kind && (i == nil || $0.i == i) } }
  private func pos(_ i: Int) -> (x: Double, y: Double) { view.screenPos(i) }
  private let empty = (x: 200.0, y: 500.0)

  func testSpawnDrag() {
    let q = view.geo.unplace(empty.x, empty.y, zoom: view.zoom), h = view.geo.holeDepth(empty.x, empty.y)
    view.down(fing(a, empty.x, empty.y, t0: 1.0, tt: 3))
    XCTAssertEqual(log.map(\.kind), [Act.spawn, Act.grab])
    XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [q.p, q.c, h]); XCTAssertEqual(log[0].t, 3)
    XCTAssertEqual(log[1].i, 0)
    rec.acts.removeAll()
    load { self.put(&$0, 0, held: true, x: q.p, y: q.c) }
    tick(1.02)
    view.move(fing(a, empty.x + 30, empty.y, t0: 1.0, x0: empty.x, y0: empty.y, tt: 4))
    let m = view.geo.unplace(empty.x + 30, empty.y, zoom: view.zoom)
    XCTAssertEqual(log.map(\.kind), [Act.move])
    XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [m.p, m.c, view.geo.holeDepth(empty.x + 30, empty.y)]); XCTAssertEqual(log[0].t, 4)
    rec.acts.removeAll()
    tick(1.6)
    view.up(fing(a, empty.x + 30, empty.y, t0: 1.0, x0: empty.x, y0: empty.y))
    XCTAssertEqual(log.map(\.kind), [Act.letGo]); XCTAssertEqual(log[0].a, [1])
  }

  func testCatch() {
    load { self.put(&$0, 1); self.put(&$0, 2, pinned: true, x: 0.7, y: 0.3) }
    tick(1)
    rec.acts.removeAll()
    let p1 = pos(1)
    view.down(fing(a, p1.x + 40, p1.y, t0: 1))
    XCTAssertEqual(log.map(\.kind), [Act.attack, Act.grab]); XCTAssertEqual(log[0].i, 1); XCTAssertEqual(log[1].i, 1)
    view.up(fing(a, p1.x + 40, p1.y, t0: 1))                // первый палец поднят: иначе второй на другой планете — мост (спека, решение 9)
    rec.acts.removeAll()
    let p2 = pos(2)
    view.down(fing(b, p2.x, p2.y, t0: 1.1))
    XCTAssertEqual(log.map(\.kind), [Act.grab], "закреплённая — без ATTACK"); XCTAssertEqual(log[0].i, 2)
    rec.acts.removeAll()
    view.up(fing(b, 0, 0, t0: 1.1))
    rec.acts.removeAll()
    tick(2)
    view.down(fing(c, p1.x + 60, p1.y, t0: 2))
    XCTAssertEqual(log.first?.kind, Act.spawn, "в 60 px — новая")
  }

  func testSpawnFull() {
    load {
      for i in 0..<3 { self.put(&$0, i, pinned: true, x: 0.2 + 0.1 * Double(i)) }
      for i in 3..<6 { self.put(&$0, i, held: true, x: 0.2 + 0.1 * Double(i)) }
    }
    tick(1)
    rec.acts.removeAll()
    for i in 0..<6 { XCTAssertGreaterThan(hypot(pos(i).x - 330, pos(i).y - 250), 60) }
    view.down(fing(a, 330, 250, t0: 1))
    XCTAssertFalse(has(Act.spawn)); XCTAssertFalse(has(Act.grab))
    XCTAssertNotNil(view.refuse); XCTAssertEqual(view.refuse?.t0, 1)
    view.down(fing(b, 330, 300, t0: 1.1))
    XCTAssertTrue(log.isEmpty, "второй палец по пустому — тоже ничего")
  }

  func testDoubleTap() {
    load { self.put(&$0, 0) }
    tick(1)
    rec.acts.removeAll()
    let p = pos(0)
    func tap(_ d: Double, _ u: Double) {
      view.down(fing(a, p.x, p.y, t0: d)); tick(u); view.up(fing(a, p.x, p.y, t0: d))
    }
    tap(1.0, 1.05)
    XCTAssertEqual(log.map(\.kind), [Act.attack, Act.grab, Act.letGo]); XCTAssertEqual(log[2].a, [1])
    rec.acts.removeAll()
    tap(1.2, 1.3)
    XCTAssertEqual(log.map(\.kind), [Act.attack, Act.grab, Act.letGo, Act.pin])
    XCTAssertEqual(log[2].a, [0]); XCTAssertEqual(log[3].i, 0)
    XCTAssertNil(view.refuse)
  }

  func testDoubleTapSlow() {
    load { self.put(&$0, 0) }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0)); tick(1.05); view.up(fing(a, p.x, p.y, t0: 1.0))
    rec.acts.removeAll()
    view.down(fing(a, p.x, p.y, t0: 1.38)); tick(1.4); view.up(fing(a, p.x, p.y, t0: 1.38))
    XCTAssertFalse(has(Act.pin)); XCTAssertEqual(log.last?.a, [1])
  }

  func testDoubleTapFull() {
    load {
      self.put(&$0, 0)
      for i in 1..<4 { self.put(&$0, i, pinned: true, x: 0.5 + 0.1 * Double(i), y: 0.3) }
    }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0)); tick(1.05); view.up(fing(a, p.x, p.y, t0: 1.0))
    view.down(fing(a, p.x, p.y, t0: 1.2)); tick(1.3); view.up(fing(a, p.x, p.y, t0: 1.2))
    XCTAssertNotNil(view.refuse)
    XCTAssertEqual(view.refuse?.t0, 1.3)
  }

  func testDoubleTapOnNew() {                                // тап по пустому рождает планету; второй тап по ней же — закрепляет
    view.down(fing(a, empty.x, empty.y, t0: 1.0))
    let q = view.geo.unplace(empty.x, empty.y, zoom: view.zoom)
    load { self.put(&$0, 0, x: q.p, y: q.c) }
    tick(1.05)
    view.up(fing(a, empty.x, empty.y, t0: 1.0))
    let p = pos(0)
    XCTAssertLessThan(hypot(p.x - empty.x, p.y - empty.y), 52)
    rec.acts.removeAll()
    view.down(fing(a, empty.x, empty.y, t0: 1.2)); tick(1.3); view.up(fing(a, empty.x, empty.y, t0: 1.2))
    XCTAssertTrue(has(Act.pin, 0))
  }

  func testSun() {
    load { self.put(&$0, 0) }
    tick(1)
    rec.acts.removeAll()
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1, tt: 9))
    let tgt = (x: 60.0, y: bot - 60)
    view.move(fing(a, tgt.x, tgt.y, t0: 1, x0: p.x, y0: p.y, tt: 9))
    tick(1.1)
    let t = (124 - hypot(tgt.x, 60)) / 70
    let suns = rec.acts.filter { $0.kind == Act.sun && $0.i == 0 }
    XCTAssertEqual(suns.count, 1); XCTAssertEqual(suns[0].a[0], t, accuracy: 1e-9); XCTAssertEqual(suns[0].t, 9)
    tick(1.2)
    XCTAssertEqual(rec.acts.filter { $0.kind == Act.sun && $0.i == 0 }.count, 1, "та же точка — без повтора")
    view.move(fing(a, 200, 400, t0: 1, x0: p.x, y0: p.y))
    tick(1.3)
    let after = rec.acts.filter { $0.kind == Act.sun && $0.i == 0 }
    XCTAssertEqual(after.count, 2); XCTAssertEqual(after[1].a, [0])
  }

  func testHold() {
    load { self.put(&$0, 0) }
    tick(1)
    rec.acts.removeAll()
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0))
    tick(1.3)
    XCTAssertFalse(has(Act.keep)); XCTAssertNotNil(view.hold)
    tick(1.43)
    let keeps = rec.acts.filter { $0.kind == Act.keep }
    XCTAssertEqual(keeps.count, 1); XCTAssertEqual(keeps[0].a, [0]); XCTAssertEqual(view.sheetVoice, 0)
    tick(1.5)
    XCTAssertEqual(rec.acts.filter { $0.kind == Act.keep }.count, 1)
    rec.acts.removeAll()
    view.up(fing(a, p.x, p.y, t0: 1.0))                      // testTapEdges: после открытия — ни PIN, ни LETGO с fade
    XCTAssertFalse(has(Act.pin)); XCTAssertFalse(log.contains { $0.kind == Act.letGo && $0.a == [1] })
  }

  func testHoldMoved() {
    load { self.put(&$0, 0) }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0))
    view.move(fing(a, p.x + 11, p.y, t0: 1.0, x0: p.x, y0: p.y))
    tick(1.5)
    XCTAssertFalse(has(Act.keep))
  }

  func testHoldTwoFingers() {
    load { self.put(&$0, 0) }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0))
    view.down(fing(b, 330, 250, t0: 1.2))
    tick(1.5)
    XCTAssertFalse(has(Act.keep))
  }

  func testTapEdgesAfterHoldTap() {                          // тап короче удержания не открывает плашку
    load { self.put(&$0, 0) }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1.0)); tick(1.1)
    XCTAssertFalse(has(Act.keep)); XCTAssertNil(view.sheetVoice)
  }

  func testPinch() {
    view.down(fing(a, 200, 500, t0: 1.0))
    view.down(fing(b, 260, 500, t0: 1.2))
    load { self.put(&$0, 0, held: true); self.put(&$0, 1, held: true, x: 0.6) }
    tick(1.5)
    rec.acts.removeAll()
    let z0 = view.zoomT
    view.move(fing(b, 290, 500, t0: 1.2, x0: 260, y0: 500))          // d 60 → 90: Δ > 26, зум пошёл
    XCTAssertEqual(log.map(\.kind), [Act.letGo, Act.release, Act.letGo, Act.release])
    XCTAssertEqual(log[0].a, [0]); XCTAssertEqual(log[1].a, [0.03]); XCTAssertEqual(Set([log[0].i, log[2].i]), [0, 1])
    XCTAssertEqual(view.zoomT, z0, accuracy: 1e-12)
    rec.acts.removeAll()
    view.move(fing(b, 320, 500, t0: 1.2, x0: 260, y0: 500))          // d 120: zoomT = z0·90/120
    XCTAssertTrue(log.isEmpty)
    XCTAssertEqual(view.zoomT, z0 * 90 / 120, accuracy: 1e-12)
    XCTAssertGreaterThan(view.zoomShow, view.now)
    view.up(fing(b, 320, 500, t0: 1.2)); view.up(fing(a, 200, 500, t0: 1.0))
    XCTAssertTrue(log.isEmpty, "палец пары на up — ни PIN, ни LETGO")
  }

  func testPinchTooLate() {
    view.down(fing(a, 200, 500, t0: 1.0))
    view.down(fing(b, 260, 500, t0: 1.3))
    let z0 = view.zoomT
    load { self.put(&$0, 0, held: true); self.put(&$0, 1, held: true, x: 0.6) }
    tick(1.5)
    rec.acts.removeAll()
    view.move(fing(b, 330, 500, t0: 1.3, x0: 260, y0: 500))
    XCTAssertFalse(has(Act.release)); XCTAssertEqual(view.zoomT, z0)
    XCTAssertTrue(has(Act.move), "вторая планета тянется как обычный палец")
  }

  func testVoiceGoneMidDrag() {
    load { self.put(&$0, 2) }
    tick(1)
    let p = pos(2)
    view.down(fing(a, p.x, p.y, t0: 1))
    load { self.put(&$0, 2, active: false) }
    tick(1.1)
    rec.acts.removeAll()
    view.move(fing(a, p.x + 30, p.y, t0: 1, x0: p.x, y0: p.y))
    XCTAssertFalse(has(Act.move, 2))
    load { self.put(&$0, 2) }                                // ядро заняло индекс заново
    tick(1.2)
    view.up(fing(a, p.x + 30, p.y, t0: 1))
    XCTAssertTrue(log.isEmpty)
  }

  func testRestoredMidDrag() {
    load { self.put(&$0, 0) }
    tick(1)
    let p = pos(0)
    view.down(fing(a, p.x, p.y, t0: 1))
    view.restored()
    rec.acts.removeAll()
    view.move(fing(a, p.x + 30, p.y, t0: 1, x0: p.x, y0: p.y)); view.up(fing(a, p.x + 30, p.y, t0: 1))
    XCTAssertTrue(log.isEmpty)
    XCTAssertNil(view.hold)
  }

  func testRestoredMidPinch() {
    view.down(fing(a, 200, 500, t0: 1.0)); view.down(fing(b, 260, 500, t0: 1.1))
    load { self.put(&$0, 0, held: true); self.put(&$0, 1, held: true, x: 0.6) }
    tick(1.3)
    view.restored()
    rec.acts.removeAll()
    let z0 = view.zoomT
    view.move(fing(b, 330, 500, t0: 1.1, x0: 260, y0: 500)); view.up(fing(b, 330, 500, t0: 1.1)); view.up(fing(a, 200, 500, t0: 1.0))
    XCTAssertTrue(log.isEmpty); XCTAssertEqual(view.zoomT, z0)
    XCTAssertNil(view.pinch)
  }

  func testCancel() {
    view.down(fing(a, empty.x, empty.y, t0: 1))
    load { self.put(&$0, 0, held: true) }
    tick(1.05)
    rec.acts.removeAll()
    view.cancel(fing(a, empty.x, empty.y, t0: 1))
    XCTAssertEqual(log.map(\.kind), [Act.letGo]); XCTAssertEqual(log[0].a, [1]); XCTAssertEqual(log[0].i, 0)
    XCTAssertTrue(view.fingers.isEmpty)
  }

  func testHugeAndNaN() {                                    // Int(Double) вне Int падает; NaN в событии — не действие
    view.down(fing(a, .nan, 5, t0: 1))
    XCTAssertTrue(rec.acts.isEmpty)
    view.down(fing(a, 1e300, -1e300, t0: 1))
    XCTAssertTrue(view.fingers.count <= 1)
    view.up(fing(a, 1e300, 1e300, t0: 1))
    view.down(fing(b, empty.x, empty.y, t0: 2))
    rec.acts.removeAll()
    view.move(fing(b, 1e300, 1e300, t0: 2, x0: empty.x, y0: empty.y))
    view.move(fing(b, .infinity, 3, t0: 2, x0: empty.x, y0: empty.y))
    tick(2.1)
    for x in rec.acts { XCTAssertTrue(x.a.allSatisfy { $0.isFinite }) }
    view.down(fing(c, 1e300, 1e300, t0: 2.1))
    XCTAssertTrue(rec.acts.allSatisfy { $0.a.allSatisfy { $0.isFinite } })
    view.up(fing(c, 1e300, 1e300, t0: 2.1)); view.up(fing(b, 1e300, 1e300, t0: 2))
  }
}
