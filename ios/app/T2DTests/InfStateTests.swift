import XCTest
@testable import T2D

final class InfStateTests: XCTestCase {
  // ГСЧ по зерну (xorshift)
  private func rng(_ seed: UInt64) -> () -> Double {
    var x = seed
    return { x ^= x << 13; x ^= x >> 7; x ^= x << 17; return Double(x >> 11) / Double(1 << 53) }
  }
  private let geo = InfGeo(W: 390, H: 844, topY: 50, safeBot: 34)

  func testOwnField() {
    var s = InfState(); var m = InfMirror()
    m.circ[2].pos = 0.5
    s.own(2, key: 0, 0.8, now: 1)
    XCTAssertEqual(s.value(2, key: 0, mirror: m, now: 1.1), 0.8)
    XCTAssertEqual(s.value(2, key: 0, mirror: m, now: 1.26), 0.5)
    m.circ[2].pos = 0.8
    XCTAssertEqual(s.value(2, key: 0, mirror: m, now: 1.05), 0.8)
    s.own(2, key: 0, 0.8, now: 2)
    m.circ[2].pos = 0.8
    s.sync(m)
    m.circ[2].pos = 0.6
    XCTAssertEqual(s.value(2, key: 0, mirror: m, now: 2.1), 0.6)
    // color
    m.circ[3].color = 1
    s.own(3, key: 4, 3, now: 5)
    XCTAssertEqual(s.value(3, key: 4, mirror: m, now: 5.1), 3)
    XCTAssertEqual(s.circ(3, mirror: m, now: 5.1).color, 3)
    XCTAssertEqual(s.circ(3, mirror: m, now: 5.3).color, 1)
    // fx
    m.fx[1] = 0.2
    s.ownFx(1, 0.9, now: 7)
    XCTAssertEqual(s.fx(1, mirror: m, now: 7.1), 0.9)
    XCTAssertEqual(s.fx(1, mirror: m, now: 7.26), 0.2)
    m.fx[1] = 0.9
    s.sync(m)
    m.fx[1] = 0.4
    XCTAssertEqual(s.fx(1, mirror: m, now: 7.1), 0.4)
  }

  func testPinMax() {
    var s = InfState(); var m = InfMirror()
    for k in 0..<3 { m.circ[k].sinner = true }
    XCTAssertTrue(s.pinResult(5, mirror: m, now: 1))
    s.ownSinner(5, true, now: 1)
    XCTAssertFalse(s.pinResult(6, mirror: m, now: 1.05))
    XCTAssertFalse(s.pinResult(1, mirror: m, now: 1.05))
  }

  func testClearSinners() {
    var s = InfState(); var m = InfMirror()
    m.circ[3].sinner = true
    s.clearSinners(now: 1)
    XCTAssertFalse(s.circ(3, mirror: m, now: 1.1).sinner)
    XCTAssertFalse(s.circ(3, mirror: m, now: 1.24).sinner)
    XCTAssertTrue(s.circ(3, mirror: m, now: 1.25).sinner)
  }

  func testLvlAfterStrike() {
    var s = InfState(); var m = InfMirror()
    s.strike(4, now: 1)
    XCTAssertEqual(s.circ(4, mirror: m, now: 1).lvl, 1, accuracy: 1e-12)
    XCTAssertEqual(s.circ(4, mirror: m, now: 1.2).lvl, exp(-0.5), accuracy: 1e-12)
    m.circ[4].lvl = 0.9
    XCTAssertEqual(s.circ(4, mirror: m, now: 1.2).lvl, 0.9)
  }

  func testHeld() {
    var s = InfState(); let m = InfMirror()
    s.heldAdd(2, 1); s.heldAdd(2, 1)
    XCTAssertEqual(s.held(2), 2)
    XCTAssertTrue(s.burning(2, mirror: m, now: 1))
    s.heldAdd(2, -1)
    XCTAssertTrue(s.burning(2, mirror: m, now: 1))
    s.heldAdd(2, -1)
    XCTAssertFalse(s.burning(2, mirror: m, now: 1))
  }

  func testSparks() {
    var s = InfState(); let m = InfMirror(); let R = rng(42)
    s.spark(4, 10, geo: geo, R: R)
    XCTAssertEqual(s.sparkCount, 10)
    let r = geo.rings[4]
    for i in 0..<10 {
      let p = s.sparkAt(i)
      XCTAssertGreaterThanOrEqual(p.y, r.cy)
      XCTAssertLessThanOrEqual(abs(p.x - geo.cx), r.rx + 1e-9)
    }
    var t = InfState()
    for _ in 0..<20 { t.spark(0, 10, geo: geo, R: R) }
    XCTAssertEqual(t.sparkCount, 160)
    for i in 0..<20 { t.sparkTick(dt: 0.1, nowMs: Double(i) * 100, mirror: m, now: Double(i) * 0.1, geo: geo, R: R) }
    XCTAssertEqual(t.sparkCount, 0)
    // dt зажат
    var a = InfState(), b = InfState()
    a.spark(1, 3, geo: geo, R: rng(7)); b.spark(1, 3, geo: geo, R: rng(7))
    a.sparkTick(dt: 0.5, nowMs: 100, mirror: m, now: 0, geo: geo, R: rng(9))
    b.sparkTick(dt: 0.1, nowMs: 100, mirror: m, now: 0, geo: geo, R: rng(9))
    XCTAssertEqual(a.sparkCount, b.sparkCount)
    for i in 0..<a.sparkCount {
      XCTAssertEqual(a.sparkAt(i).x, b.sparkAt(i).x); XCTAssertEqual(a.sparkAt(i).y, b.sparkAt(i).y)
    }
  }

  func testSparkTickEmits() {
    var s = InfState(); var m = InfMirror()
    m.circ[2].lvl = 1
    s.sparkTick(dt: 0.1, nowMs: 0, mirror: m, now: 0, geo: geo, R: { 0 })
    XCTAssertEqual(s.sparkCount, 1)
  }

  func testSpin() {
    var s = InfState(); var m = InfMirror()
    s.spin(dt: 1, mirror: m, now: 0)
    XCTAssertEqual(s.rot[0], -0.004, accuracy: 1e-12)
    XCTAssertEqual(s.rot[1], 0.004, accuracy: 1e-12)
    m.circ[2].lvl = 1
    var t = InfState()
    t.spin(dt: 0.1, mirror: m, now: 0)
    XCTAssertEqual(t.rot[2], -0.074, accuracy: 1e-12)
  }

  func testReset() {
    var s = InfState(); var m = InfMirror(); let R = rng(3)
    s.own(1, key: 0, 0.9, now: 1); s.ownFx(0, 0.7, now: 1); s.ownSinner(2, true, now: 1)
    s.strike(3, now: 1); s.heldAdd(4, 1)
    s.spark(0, 5, geo: geo, R: R); s.spin(dt: 0.1, mirror: m, now: 1)
    let rot = s.rot
    s.reset()
    XCTAssertEqual(s.value(1, key: 0, mirror: m, now: 1.1), 0.5)
    XCTAssertEqual(s.fx(0, mirror: m, now: 1.1), 0)
    XCTAssertFalse(s.circ(2, mirror: m, now: 1.1).sinner)
    XCTAssertEqual(s.circ(3, mirror: m, now: 1.1).lvl, 0)
    XCTAssertEqual(s.held(4), 0)
    XCTAssertEqual(s.sparkCount, 5)
    XCTAssertEqual(s.rot, rot)
    m.circ[0].lvl = 0
  }
}
