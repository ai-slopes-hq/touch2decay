import XCTest
@testable import T2D

final class ArcStateTests: XCTestCase {
  func mirror(on: [Int], u: Double = 0.1, v: Double = 0.2, mode: Double = 2, cx: Double = 0.3, cy: Double = 0.4) -> ArcMirror {
    var m = ArcMirror()
    for s in on { m.slots[s] = ArcSlot(on: true, u: u, v: v, oct: 0, r: 0.16, fig: 0, mode: mode, sp: 0.22, lvl: 0.8, f: 110, cx: cx, cy: cy, rs: 0, gain: 0) }
    return m
  }

  func testAddPicksFirstFree() {
    var st = ArcState(); let m = ArcMirror()
    XCTAssertEqual(st.add(u: 0, v: 0, mirror: m, now: 0), 0)
    XCTAssertEqual(st.add(u: 0, v: 0, mirror: m, now: 0), 1)
    XCTAssertEqual(st.order, [0, 1])
    _ = st.add(u: 0, v: 0, mirror: m, now: 0); _ = st.add(u: 0, v: 0, mirror: m, now: 0)
    XCTAssertNil(st.add(u: 0, v: 0, mirror: m, now: 0))
  }

  func testReusedSlotAfterClear() {
    var st = ArcState()
    for k in 0..<3 { XCTAssertEqual(st.add(u: 0.1, v: 0.2, mirror: ArcMirror(), now: 0), k) }
    XCTAssertEqual(st.sync(mirror(on: [0, 1, 2]), now: 0.05), [])
    XCTAssertEqual(st.dropAll(now: 0.1), [0, 1, 2])
    let stale = mirror(on: [0, 1, 2])
    XCTAssertEqual(st.add(u: 0.5, v: 0.6, mirror: stale, now: 0.1), 0)
    XCTAssertEqual(st.add(u: 0.7, v: 0.8, mirror: stale, now: 0.1), 1)
    XCTAssertEqual(st.sync(stale, now: 0.12), [])
    XCTAssertEqual(st.order, [0, 1])
    var fresh = ArcMirror()
    fresh.slots[0] = ArcSlot(on: true, u: 0.5, v: 0.6); fresh.slots[1] = ArcSlot(on: true, u: 0.7, v: 0.8)
    XCTAssertEqual(st.sync(fresh, now: 0.14), [])
    XCTAssertEqual(st.order, [0, 1])
    XCTAssertEqual(st.sync(fresh, now: 0.2), [])
  }

  func testAddFailedFreesSlot() {
    var st = ArcState(); let m = ArcMirror()
    XCTAssertEqual(st.add(u: 0, v: 0, mirror: m, now: 0), 0)
    st.addFailed(0)
    XCTAssertEqual(st.order, [])
    XCTAssertEqual(st.add(u: 0, v: 0, mirror: m, now: 0), 0)
  }

  func testPendingTimeout() {
    var st = ArcState()
    XCTAssertEqual(st.add(u: 0.1, v: 0.2, mirror: ArcMirror(), now: 0), 0)
    XCTAssertEqual(st.sync(ArcMirror(), now: 0.1), [])
    XCTAssertEqual(st.sync(ArcMirror(), now: 0.3), [0])
    XCTAssertEqual(st.order, [])
    XCTAssertEqual(st.add(u: 0.1, v: 0.2, mirror: ArcMirror(), now: 1), 0)
    _ = st.sync(mirror(on: [0]), now: 1.05)
    st.drop(0, now: 1.1)
    XCTAssertEqual(st.order, [])
    XCTAssertEqual(st.sync(mirror(on: [0]), now: 1.2), [])
    XCTAssertEqual(st.order, [])
    XCTAssertEqual(st.sync(mirror(on: [0]), now: 1.4), [])
    XCTAssertEqual(st.order, [0])
  }

  func testRestoreOrder() {
    var st = ArcState()
    XCTAssertEqual(st.sync(mirror(on: [3, 1]), now: 0), [])
    XCTAssertEqual(st.order, [1, 3])
    XCTAssertEqual(st.sync(mirror(on: [3]), now: 0.1), [1])
    XCTAssertEqual(st.order, [3])
  }

  func testOwnValues() {
    var st = ArcState()
    _ = st.sync(mirror(on: [0], u: 0.1), now: 0)
    st.setOwn(0, key: 0, 0.4, now: 0.1)
    _ = st.sync(mirror(on: [0], u: 0.1), now: 0.2)
    XCTAssertEqual(st.value(0, key: 0, mirror: mirror(on: [0], u: 0.1)), 0.4)
    _ = st.sync(mirror(on: [0], u: 0.4), now: 0.25)
    XCTAssertEqual(st.value(0, key: 0, mirror: mirror(on: [0], u: 0.7)), 0.7)   // сошлось — своё снято
    st.setOwn(0, key: 0, 0.9, now: 1)
    _ = st.sync(mirror(on: [0], u: 0.1), now: 1.3)
    XCTAssertEqual(st.value(0, key: 0, mirror: mirror(on: [0], u: 0.1)), 0.1)   // ttl
    // цель ожидающего ADD
    var s2 = ArcState()
    XCTAssertEqual(s2.add(u: 0.1, v: 0.2, mirror: ArcMirror(), now: 0), 0)
    s2.setOwn(0, key: 0, 0.5, now: 0.05); s2.setOwn(0, key: 1, 0.6, now: 0.05)
    var fresh = ArcMirror(); fresh.slots[0] = ArcSlot(on: true, u: 0.5, v: 0.6)
    _ = s2.sync(fresh, now: 0.1)
    XCTAssertEqual(s2.order, [0])
    // fx
    var s3 = ArcState()
    s3.setOwnFx(6, 0.7, now: 0)
    XCTAssertEqual(s3.fx(6, mirror: ArcMirror()), 0.7)
    _ = s3.sync(ArcMirror(), now: 0.1)
    XCTAssertEqual(s3.fx(6, mirror: ArcMirror()), 0.7)
    _ = s3.sync(ArcMirror(), now: 0.3)
    XCTAssertEqual(s3.fx(6, mirror: ArcMirror()), 0.4)
  }

  func testTrail() {
    var st = ArcState(); let m = mirror(on: [0])
    _ = st.sync(m, now: 0)
    for _ in 0..<20 { st.tickTrail(dt: 0.1, mirror: m) }
    XCTAssertEqual(st.trailCount(0), 10)
    XCTAssertEqual(st.trailPoint(0, 0).u, 0.3)
    for _ in 0..<100 { st.tickTrail(dt: 0.1, mirror: mirror(on: [0], cx: 0.3)) }
    XCTAssertEqual(st.trailCount(0), 40)
    let m1 = mirror(on: [0], mode: 1)
    st.tickTrail(dt: 0.1, mirror: m1); st.tickTrail(dt: 0.1, mirror: m1)
    XCTAssertEqual(st.trailCount(0), 0)
    var s2 = ArcState(); _ = s2.sync(m, now: 0)
    for _ in 0..<4 { s2.tickTrail(dt: 0.1, mirror: m) }
    s2.clearTrail(0)
    XCTAssertEqual(s2.trailCount(0), 0)
    var s3 = ArcState(); _ = s3.sync(m, now: 0)
    s3.tickTrail(dt: 5, mirror: m)
    XCTAssertEqual(s3.trailCount(0), 0)
  }
}
