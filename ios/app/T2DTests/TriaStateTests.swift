import XCTest
@testable import T2D

final class TriaStateTests: XCTestCase {
  func testHandPos() {
    var s = TriaState(); var m = TriaMirror()
    m.bodies[1].x = 0.5; m.bodies[1].y = 0.5
    s.hold(1, x: 0.2, y: 0.3)
    XCTAssertTrue(s.inHand(1))
    XCTAssertEqual(s.pos(1, mirror: m).x, 0.2); XCTAssertEqual(s.pos(1, mirror: m).y, 0.3)
    s.letGo(1)
    XCTAssertFalse(s.inHand(1))
    XCTAssertEqual(s.pos(1, mirror: m).x, 0.5); XCTAssertEqual(s.pos(1, mirror: m).y, 0.5)
  }

  func testOwnBody() {
    var s = TriaState(); var m = TriaMirror()
    m.bodies[0].m = 1.0
    s.own(0, key: 0, 2.0, now: 1)
    s.sync(m, now: 1.1)
    XCTAssertEqual(s.body(0, key: 0, mirror: m, now: 1.1), 2.0)
    XCTAssertEqual(s.body(0, key: 0, mirror: m, now: 1.26), 1.0)
    // сошлось и защёлкнулось
    s.own(0, key: 0, 2.0, now: 2)
    m.bodies[0].m = 2.0
    s.sync(m, now: 2.05)
    m.bodies[0].m = 1.5
    s.sync(m, now: 2.1)
    XCTAssertEqual(s.body(0, key: 0, mirror: m, now: 2.1), 1.5)
    // другие ключи — зеркало; fixed — 0/1
    m.bodies[2].fixed = true
    XCTAssertEqual(s.body(2, key: 2, mirror: m, now: 3), 1)
  }

  func testOwnFxAndFlags() {
    var s = TriaState(); var m = TriaMirror()
    m.fx[3] = 0.2
    s.ownFx(3, 0.9, now: 1)
    XCTAssertEqual(s.fx(3, mirror: m, now: 1.1), 0.9)
    XCTAssertEqual(s.fx(3, mirror: m, now: 1.26), 0.2)
    s.ownFx(3, 0.9, now: 2); m.fx[3] = 0.9; s.sync(m, now: 2.05); m.fx[3] = 0.4; s.sync(m, now: 2.1)
    XCTAssertEqual(s.fx(3, mirror: m, now: 2.1), 0.4)

    m.still = true
    s.ownFlags(still: false, lux: true, cadit: false, now: 5)
    var f = s.flags(mirror: m, now: 5.1)
    XCTAssertEqual([f.still, f.lux, f.cadit], [false, true, false])
    f = s.flags(mirror: m, now: 5.26)
    XCTAssertEqual([f.still, f.lux, f.cadit], [true, false, false])
    s.ownFlags(still: false, lux: true, cadit: false, now: 6)
    m.still = false; m.lux = true; s.sync(m, now: 6.05)
    m.lux = false; m.cadit = true; s.sync(m, now: 6.1)
    f = s.flags(mirror: m, now: 6.1)
    XCTAssertEqual([f.still, f.lux, f.cadit], [false, false, true])
  }

  func testTrail60Hz() {
    var s = TriaState(); var m = TriaMirror(); m.still = false
    for _ in 0..<120 { s.trailTick(dt: 1.0 / 120, mirror: m, now: 0) }
    XCTAssertEqual(s.trailCount(0), 60); XCTAssertEqual(s.trailCount(2), 60)
    for _ in 0..<400 { s.trailTick(dt: 1.0 / 60, mirror: m, now: 0) }
    XCTAssertEqual(s.trailCount(1), 180)
    m.still = true
    s.clearTrails()
    XCTAssertEqual(s.trailCount(0), 0)
    for _ in 0..<10 { s.trailTick(dt: 1.0 / 60, mirror: m, now: 0) }
    XCTAssertEqual(s.trailCount(0), 0)
    m.still = false
    s.trailTick(dt: 0.5, mirror: m, now: 0)
    XCTAssertEqual(s.trailCount(0), 1)
  }

  func testTrailOrderAndHand() {
    var s = TriaState(); var m = TriaMirror(); m.still = false
    m.bodies[0].x = 0.1; m.bodies[0].y = 0.2
    s.trailTick(dt: 1.0 / 60, mirror: m, now: 0)
    s.hold(0, x: 0.7, y: 0.8)
    s.trailTick(dt: 1.0 / 60, mirror: m, now: 0)
    XCTAssertEqual(s.trailPoint(0, 0).x, 0.1); XCTAssertEqual(s.trailPoint(0, 1).x, 0.7)
  }

  func testFlashRing() {
    var s = TriaState()
    for n in 0..<35 { s.flash(TriaFlashRec(i: 0, kind: 0, x: Double(n), y: 0, q: 0), t: Double(n)) }
    XCTAssertEqual(s.flashCount, 30)
    XCTAssertEqual(s.flashAt(0).rec.x, 5); XCTAssertEqual(s.flashAt(0).t, 5)
    XCTAssertEqual(s.flashAt(29).rec.x, 34)
  }

  func testReset() {
    var s = TriaState(); var m = TriaMirror(); m.still = false
    m.bodies[0].x = 0.4; m.bodies[0].m = 1
    s.hold(0, x: 0.9, y: 0.9); s.own(0, key: 0, 3, now: 1); s.ownFx(0, 1, now: 1)
    s.ownFlags(still: true, lux: true, cadit: true, now: 1)
    s.trailTick(dt: 0.1, mirror: m, now: 1); s.flash(TriaFlashRec(), t: 1)
    s.reset()
    XCTAssertFalse(s.inHand(0)); XCTAssertEqual(s.pos(0, mirror: m).x, 0.4)
    XCTAssertEqual(s.body(0, key: 0, mirror: m, now: 1.05), 1)
    XCTAssertEqual(s.fx(0, mirror: m, now: 1.05), 0)
    XCTAssertFalse(s.flags(mirror: m, now: 1.05).lux)
    XCTAssertEqual(s.trailCount(0), 0); XCTAssertEqual(s.flashCount, 0)
  }
}
