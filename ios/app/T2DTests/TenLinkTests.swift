import XCTest
@testable import T2D

private final class TLRec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// мост двух пальцев и кольцо связи Tenebrae (app.js:325-349, 885-982)
final class TenLinkTests: XCTestCase {
  private let rec = TLRec()
  private var mbuf: [Double] = []
  private lazy var view = TenebraeView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mbuf.count, b.count); b.replaceSubrange(0..<n, with: self.mbuf[0..<n]); return n
  }, readHeard: { _ in 0 }, readLevel: { 0 }, rng: { 0.5 })
  private let a = NSObject(), b = NSObject(), c = NSObject()
  private var span: Double { view.geo.menuSpan }

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
  private func put(_ m: inout [Double], _ i: Int, held: Bool = false, x: Double = 0.4, y: Double = 0.5, links: [(src: Double, type: Double, depth: Double, auto: Double)] = []) {
    let o = Ten.head + Ten.voiceN * i
    m[o] = 1; m[o + 1] = 1; m[o + 2] = 0; m[o + 3] = held ? 1 : 0
    m[o + 4] = x; m[o + 5] = y; m[o + 6] = 0.35; m[o + 15] = 1; m[o + 16] = 1
    m[o + 17] = Double(links.count)
    for (k, l) in links.enumerated() { let q = o + 18 + 4 * k; m[q] = l.src; m[q + 1] = l.type; m[q + 2] = l.depth; m[q + 3] = l.auto }
  }
  private func load(_ e: @escaping (inout [Double]) -> Void) { mbuf = mirror(e) }
  // планеты 0 (x .25, y .3) и 3 (x .6, y .5), связь 3 → 0 (tzfm, 0.5); 5 — в стороне
  private func linked(type: Double = 1, auto: Double = 0) {
    load { self.put(&$0, 0, x: 0.25, y: 0.3, links: [(3, type, 0.5, auto)]); self.put(&$0, 3, x: 0.6, y: 0.5); self.put(&$0, 5, x: 0.9, y: 0.8) }
  }
  private func tick(_ t: Double) { view.tick(now: t, dt: 0.016) }
  private func fing(_ id: NSObject, _ x: Double, _ y: Double, t0: Double, tt: Double = 0) -> Finger {
    Finger(id: ObjectIdentifier(id), x: x, y: y, x0: x, y0: y, t0: t0, moved: false, touchTime: tt == 0 ? t0 : tt)
  }
  private var log: [(kind: Int, i: Int, a: [Double], t: Double)] { rec.acts.filter { $0.kind != Act.sun } }
  private func has(_ kind: Int) -> Bool { rec.acts.contains { $0.kind == kind } }
  private func pos(_ i: Int) -> (x: Double, y: Double) { view.screenPos(i) }
  private func dir(_ deg: Double, _ d: Double, from p: (x: Double, y: Double)) -> (x: Double, y: Double) {
    (p.x + d * cos(deg * .pi / 180), p.y + d * sin(deg * .pi / 180))
  }
  private var mid: (x: Double, y: Double) { view.linkMid(dst: 0, src: 3) }

  // A держит палец a, второй палец b на планете 3 — мост
  private func bridgeUp() -> (pa: (x: Double, y: Double), pb: (x: Double, y: Double)) {
    load { self.put(&$0, 0, x: 0.25, y: 0.3); self.put(&$0, 3, x: 0.6, y: 0.5); self.put(&$0, 5, x: 0.9, y: 0.8) }
    tick(1)
    let pa = pos(0), pb = pos(3)
    view.down(fing(a, pa.x, pa.y, t0: 1))
    rec.acts.removeAll()
    view.down(fing(b, pb.x, pb.y, t0: 1.1))
    return (pa, pb)
  }
  private func openRing() -> (x: Double, y: Double) {      // палец c на ручке; точка касания — возвращается
    linked()
    tick(1)
    let m = mid
    rec.acts.removeAll()
    view.down(fing(c, m.x, m.y, t0: 1))
    return m
  }

  func testBridge() {
    let (pa, pb) = bridgeUp()
    XCTAssertEqual(log.map(\.kind), [Act.attack, Act.grab, Act.link])
    XCTAssertEqual(log.map(\.i), [3, 3, 0]); XCTAssertEqual(log[2].a, [3])
    XCTAssertNotNil(view.bridge)
    rec.acts.removeAll()
    view.move(fing(b, pa.x + (pb.x - pa.x) * 1.3, pa.y + (pb.y - pa.y) * 1.3, t0: 1.1))
    XCTAssertEqual(log.map(\.kind), [Act.linkDepth]); XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a[0], 3)
    XCTAssertEqual(log[0].a[1], 0.5 + 1.3 - 1, accuracy: 1e-9)
    rec.acts.removeAll()
    view.move(fing(b, pa.x + (pb.x - pa.x) * 2, pa.y + (pb.y - pa.y) * 2, t0: 1.1))
    XCTAssertEqual(log[0].a[1], 1, "0.5 + 2 − 1 = 1.5 → 1")
    rec.acts.removeAll()
    view.move(fing(b, pa.x + (pb.x - pa.x) * 0.54, pa.y + (pb.y - pa.y) * 0.54, t0: 1.1))
    XCTAssertEqual(log[0].a[1], 0.04, accuracy: 1e-9)
    rec.acts.removeAll()
    view.up(fing(b, pa.x, pa.y, t0: 1.1))
    XCTAssertEqual(log.map(\.kind), [Act.unlink, Act.letGo]); XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [3])
    XCTAssertEqual(log[1].i, 3); XCTAssertNil(view.bridge)
    rec.acts.removeAll()
    view.move(fing(a, pa.x + 20, pa.y, t0: 1))
    XCTAssertEqual(log.map(\.kind), [Act.move], "оставшийся палец ведёт A дальше"); XCTAssertEqual(log[0].i, 0)
    let q = view.geo.unplace(pa.x + 20, pa.y, zoom: view.zoom)
    XCTAssertEqual(log[0].a[0], q.p, accuracy: 1e-6, "без прыжка: смещение пересчитано")
  }

  func testBridgeKeepsThickLink() {
    let (pa, pb) = bridgeUp()
    rec.acts.removeAll()
    view.move(fing(b, pa.x + (pb.x - pa.x) * 1.1, pa.y + (pb.y - pa.y) * 1.1, t0: 1.1))
    XCTAssertEqual(log[0].a[1], 0.6, accuracy: 1e-9)
    rec.acts.removeAll()
    view.up(fing(b, pa.x, pa.y, t0: 1.1))
    XCTAssertFalse(has(Act.unlink)); XCTAssertEqual(log.map(\.kind), [Act.letGo])
  }

  func testBridgeNotWhenTwoHeld() {
    _ = bridgeUp()
    rec.acts.removeAll()
    let p5 = pos(5)
    view.down(fing(c, p5.x, p5.y, t0: 1.2))
    XCTAssertEqual(log.map(\.kind), [Act.attack, Act.grab], "третий палец — не мост"); XCTAssertEqual(log[0].i, 5)
    XCTAssertFalse(has(Act.link))
  }

  func testBridgeHuge() {
    let (pa, pb) = bridgeUp()
    rec.acts.removeAll()
    view.move(fing(b, 1e300, -1e300, t0: 1.1))
    XCTAssertEqual(log[0].a[1], 1)
    view.move(fing(b, .nan, 5, t0: 1.1)); view.move(fing(b, .infinity, 5, t0: 1.1))
    XCTAssertEqual(log.count, 1, "не конечное — событие брошено")
    view.up(fing(b, pb.x, pb.y, t0: 1.1)); view.up(fing(a, pa.x, pa.y, t0: 1))
  }

  func testHandleRing() {
    let m = openRing()
    XCTAssertEqual(log.map(\.kind), [Act.link]); XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [3])
    let r = try! XCTUnwrap(view.ring)
    let rc = view.ringCenter(m.x, m.y)
    XCTAssertEqual(r.cx, rc.x, accuracy: 1e-9); XCTAssertEqual(r.cy, rc.y, accuracy: 1e-9)
    XCTAssertFalse(r.pinned); XCTAssertTrue(r.overPin)
    rec.acts.removeAll()
    let t = dir(54, 40 + 0.5 * span, from: m)
    view.move(fing(c, t.x, t.y, t0: 1))
    XCTAssertEqual(log.map(\.kind), [Act.linkType, Act.linkDepth])
    XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [3, 2])
    XCTAssertEqual(log[1].a[0], 3); XCTAssertEqual(log[1].a[1], 0.5, accuracy: 1e-9)
    XCTAssertFalse(view.ring!.overPin)
    rec.acts.removeAll()
    tick(2)
    view.up(fing(c, t.x, t.y, t0: 1))
    XCTAssertNil(view.ring)
    let g = try! XCTUnwrap(view.ghost)
    XCTAssertEqual(g.until, 2 + 1.6, accuracy: 1e-9)
    XCTAssertTrue(log.isEmpty, "отпускание вне булавки и без разреза ничего не шлёт")
  }

  func testAutoLinkHasNoHandle() {
    linked(auto: 1)
    tick(1)
    let m = mid
    rec.acts.removeAll()
    view.down(fing(c, m.x, m.y, t0: 1))
    XCTAssertNil(view.ring, "хаос-связь (auto) ручки не имеет")
  }

  func testRingCut() {
    var m = openRing()
    rec.acts.removeAll()
    var t = dir(198, 40 + 0.4 * span, from: m)
    view.move(fing(c, t.x, t.y, t0: 1))
    XCTAssertTrue(view.ring!.cutting)
    XCTAssertTrue(log.isEmpty, "cut только флаг")
    view.up(fing(c, t.x, t.y, t0: 1))
    XCTAssertEqual(log.map(\.kind), [Act.unlink]); XCTAssertEqual(log[0].i, 0); XCTAssertEqual(log[0].a, [3])
    XCTAssertNil(view.ring); XCTAssertNil(view.ghost, "связи нет — призрака нет")
    // t 0.3 — не разрез
    rec.acts.removeAll()
    view.restored()
    m = openRing()
    rec.acts.removeAll()
    t = dir(198, 40 + 0.3 * span, from: m)
    view.move(fing(c, t.x, t.y, t0: 1))
    view.up(fing(c, t.x, t.y, t0: 1))
    XCTAssertFalse(has(Act.unlink)); XCTAssertNotNil(view.ghost)
  }

  func testRingPin() {
    var m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))                        // отпустил на булавке
    XCTAssertEqual(view.ring?.pinned, true); XCTAssertNil(view.ghost)
    // вытянул и вернул в центр — тоже булавка
    view.restored()
    m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1)); XCTAssertFalse(view.ring!.overPin)
    view.move(fing(c, m.x + 10, m.y, t0: 1)); XCTAssertTrue(view.ring!.overPin)
    view.up(fing(c, m.x + 10, m.y, t0: 1))
    XCTAssertEqual(view.ring?.pinned, true)
    // призрак: тап по булавке в 1.6 с
    view.restored()
    m = openRing()
    view.move(fing(c, t.x, t.y, t0: 1)); tick(2)
    view.up(fing(c, t.x, t.y, t0: 1))
    let rc = (x: view.ghost!.ring.cx, y: view.ghost!.ring.cy)
    rec.acts.removeAll()
    tick(3)
    view.down(fing(a, rc.x + 20, rc.y, t0: 3))
    XCTAssertEqual(view.ring?.pinned, true); XCTAssertNil(view.ghost); XCTAssertTrue(log.isEmpty, "касание съедено")
  }

  func testGhostExpired() {
    let m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1)); tick(2)
    view.up(fing(c, t.x, t.y, t0: 1))
    let rc = (x: view.ghost!.ring.cx, y: view.ghost!.ring.cy)
    rec.acts.removeAll()
    tick(3.7)                                                // 1.7 с спустя
    view.down(fing(a, rc.x, rc.y + 28, t0: 3.7))
    XCTAssertNil(view.ghost); XCTAssertNil(view.ring)
    XCTAssertTrue(has(Act.grab), "касание пошло в поле (новая или поймана планета)")
  }

  func testGhostEaten() {                                    // любое касание гасит призрак
    let m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1)); tick(2)
    view.up(fing(c, t.x, t.y, t0: 1))
    tick(2.5)
    let p5 = pos(5)
    view.down(fing(a, p5.x, p5.y, t0: 2.5))
    XCTAssertNil(view.ghost)
  }

  func testTapHandle() {
    let m = openRing()
    tick(1.1)
    view.up(fing(c, m.x, m.y, t0: 1))
    XCTAssertEqual(view.ring?.pinned, true)
  }

  func testHangingRingPinByOtherFinger() {
    let m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1))
    rec.acts.removeAll()
    let rc = (x: view.ring!.cx, y: view.ring!.cy)
    view.down(fing(a, rc.x, rc.y, t0: 1.2))
    XCTAssertEqual(view.ring?.pinned, true); XCTAssertNil(view.ring?.finger); XCTAssertTrue(log.isEmpty)
    view.move(fing(c, t.x + 30, t.y, t0: 1)); view.up(fing(c, t.x + 30, t.y, t0: 1))
    XCTAssertTrue(log.isEmpty, "палец-держатель больше ничего не двигает")
    XCTAssertEqual(view.ring?.pinned, true)
  }

  func testPinnedRing() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    let r = view.ring!
    rec.acts.removeAll()
    let t = dir(126, 40 + 0.25 * span, from: (r.cx, r.cy))
    view.down(fing(a, t.x, t.y, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.linkType, Act.linkDepth]); XCTAssertEqual(log[0].a, [3, 3])
    XCTAssertEqual(log[1].a[1], 0.25, accuracy: 1e-9)
    view.up(fing(a, t.x, t.y, t0: 2))
    XCTAssertEqual(view.ring?.pinned, true, "кольцо остаётся")
    // центр — ничего
    rec.acts.removeAll()
    view.down(fing(a, r.cx, r.cy, t0: 3)); view.up(fing(a, r.cx, r.cy, t0: 3))
    XCTAssertTrue(log.isEmpty); XCTAssertNotNil(view.ring)
    // close-чип
    view.down(fing(a, 390 - 80 + 10, 844 - 34 - 320 + 10, t0: 4))
    XCTAssertNil(view.ring); XCTAssertTrue(log.isEmpty)
  }

  func testPinnedRingOutside() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    let r = view.ring!
    rec.acts.removeAll()
    let far = (x: r.cx < 195 ? r.cx + 40 + span + 34 + 6 : r.cx - 40 - span - 34 - 6, y: r.cy)
    view.down(fing(a, far.x, far.y, t0: 2))
    XCTAssertNil(view.ring); XCTAssertTrue(log.isEmpty, "мимо кольца: закрыть, в поле не идёт")
    XCTAssertTrue(view.fingers.isEmpty)
  }

  func testPinnedRingCut() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    let r = view.ring!
    rec.acts.removeAll()
    let t = dir(198, 40 + 0.5 * span, from: (r.cx, r.cy))
    view.down(fing(a, t.x, t.y, t0: 2))
    XCTAssertTrue(log.isEmpty)
    view.up(fing(a, t.x, t.y, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.unlink]); XCTAssertNil(view.ring)
  }

  func testPinnedRingHuge() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    let r = view.ring!
    let t = dir(54, 100, from: (r.cx, r.cy))
    view.down(fing(a, t.x, t.y, t0: 2))
    rec.acts.removeAll()
    view.move(fing(a, 1e300, 1e300, t0: 2))
    XCTAssertEqual(log.map(\.kind), [Act.linkDepth]); XCTAssertEqual(log[0].a[1], 1)
    view.move(fing(a, .nan, 0, t0: 2))
    XCTAssertEqual(log.count, 1, "NaN — событие брошено")
    view.up(fing(a, 1e300, 1e300, t0: 2))
  }

  func testHugeMirrorLinkType() {
    load { self.put(&$0, 0, x: 0.25, y: 0.3, links: [(3, 1e300, 0.5, 0)]); self.put(&$0, 3, x: 0.6, y: 0.5) }
    tick(1)
    XCTAssertTrue(view.voice(0).mods.isEmpty, "тип 1e300 — связь отброшена без падения")
    let p = pos(0)
    view.down(fing(c, p.x, p.y, t0: 1))
    XCTAssertNil(view.ring)
  }

  func testRingClosesWhenGone() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    XCTAssertNotNil(view.ring)
    load { self.put(&$0, 0, x: 0.25, y: 0.3); self.put(&$0, 3, x: 0.6, y: 0.5) }   // связи нет
    tick(2)
    XCTAssertNil(view.ring)
    // и призрак
    linked(); tick(2.1)
    let m2 = mid
    view.down(fing(c, m2.x, m2.y, t0: 2.1))
    view.move(fing(c, m2.x + 90, m2.y, t0: 2.1)); tick(2.2)
    view.up(fing(c, m2.x + 90, m2.y, t0: 2.1))
    XCTAssertNotNil(view.ghost)
    load { self.put(&$0, 0, x: 0.25, y: 0.3, links: []); self.put(&$0, 3, x: 0.6, y: 0.5) }
    tick(2.6)                                                // свои значения старше 0.25 с — зеркало решает
    XCTAssertNil(view.ghost)
  }

  func testRingClosesWhenDstGone() {
    let m = openRing()
    view.up(fing(c, m.x, m.y, t0: 1))
    load { self.put(&$0, 3, x: 0.6, y: 0.5) }
    tick(2)
    XCTAssertNil(view.ring)
  }

  func testBridgeEndsWhenVoiceGone() {
    let (pa, _) = bridgeUp()
    load { self.put(&$0, 0, x: 0.25, y: 0.3) }               // B пропала
    tick(2)
    XCTAssertNil(view.bridge)
    rec.acts.removeAll()
    view.move(fing(b, 5, 5, t0: 1.1)); view.up(fing(b, 5, 5, t0: 1.1))
    XCTAssertFalse(has(Act.linkDepth)); XCTAssertFalse(has(Act.unlink))
    view.up(fing(a, pa.x, pa.y, t0: 1))
  }

  func testRestoredMidRing() {
    let m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1))
    rec.acts.removeAll()
    view.restored()
    XCTAssertNil(view.ring); XCTAssertNil(view.ghost); XCTAssertNil(view.bridge)
    view.move(fing(c, t.x + 10, t.y, t0: 1)); view.up(fing(c, t.x + 10, t.y, t0: 1))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testRestoredMidGhostAndBridge() {
    let m = openRing()
    let t = dir(54, 90, from: m)
    view.move(fing(c, t.x, t.y, t0: 1)); view.up(fing(c, t.x, t.y, t0: 1))
    XCTAssertNotNil(view.ghost)
    view.restored()
    XCTAssertNil(view.ghost)
    let (pa, pb) = bridgeUp()
    rec.acts.removeAll()
    view.restored()
    XCTAssertNil(view.bridge)
    view.move(fing(b, pb.x + 30, pb.y, t0: 1.1)); view.up(fing(b, pb.x, pb.y, t0: 1.1)); view.up(fing(a, pa.x, pa.y, t0: 1))
    XCTAssertTrue(rec.acts.isEmpty)
  }
}
