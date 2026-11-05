import XCTest

final class HoroMathTests: XCTestCase {
  private func rings(_ on: [Int], under: [Int] = []) -> [HoroRing] {
    (0..<Horo.nr).map { HoroRing(n: $0 + 2, on: on.contains($0 + 2), under: under.contains($0 + 2), phi: 0, lvl: 0.8) }
  }

  func testEuclid() {
    XCTAssertEqual((0..<16).filter { Horo.euclid($0, 3, 16) }.count, 3)
    XCTAssertEqual((0..<12).filter { Horo.euclid($0, 5, 12) }.count, 5)
    XCTAssertTrue(Horo.euclid(0, 4, 16)); XCTAssertTrue((0..<6).allSatisfy { Horo.euclid($0, 6, 6) })
  }

  func testRot() {
    for (phi, L, want) in [(0.0, 16, 0), (3.0 / 16, 16, 3), (0.5, 12, 6), (-0.25, 16, 12), (1.0, 16, 0), (0.99, 16, 0), (.nan, 16, 0), (1e300, 16, 0), (.infinity, 8, 0)] {
      XCTAssertEqual(Horo.rot(phi, L), want, "rot \(phi) \(L)")
    }
  }

  func testSlot() {
    func r(under: Bool = false, phi: Double = 0, len: Int = 16) -> HoroRing { HoroRing(n: 2, under: under, phi: phi, len: len) }
    XCTAssertEqual(Horo.slot(r(), P: 0.5), 8); XCTAssertEqual(Horo.slot(r(len: 12), P: 1), 4)
    XCTAssertEqual(Horo.slot(r(under: true), P: 0.5), 4); XCTAssertEqual(Horo.slot(r(phi: 3.0 / 16), P: 0), 3)
    XCTAssertEqual(Horo.slot(r(), P: -0.01), 15); XCTAssertEqual(Horo.slot(r(), P: .nan), 0)
    for L in [1, 7, 16] { for P in [1e300, -1e300, Double.infinity] { XCTAssertTrue((0..<L).contains(Horo.slot(r(phi: 1e300, len: L), P: P))) } }
    XCTAssertEqual(Horo.steps(r()), 16); XCTAssertEqual(Horo.steps(r(under: true)), 8)
  }

  func testLenAfter() {
    let step = 2 * Double.pi / 16
    XCTAssertEqual(Horo.lenAfter(8, turned: 2.4 * step), 10); XCTAssertEqual(Horo.lenAfter(8, turned: -2.6 * step), 5)
    XCTAssertEqual(Horo.lenAfter(3, turned: -100), 1); XCTAssertEqual(Horo.lenAfter(14, turned: 5 * step), 16)
    XCTAssertEqual(Horo.lenAfter(8, turned: .nan), 8); XCTAssertEqual(Horo.lenAfter(8, turned: 1e300), 16)
  }

  func testLenGestureOvershoot() {                         // кружишь за предел 16 — разворот отзывается сразу, без «размотки» лишнего
    let step = 2 * Double.pi / 16
    var g = (len0: 16, turn: 0.0)
    g.turn += 2 * 2 * Double.pi                              // два полных оборота вперёд
    let a = Horo.lenGesture(len0: g.len0, turn: g.turn)
    XCTAssertEqual(a.len, 16); g = (a.len0, a.turn)
    g.turn -= step                                           // один шаг назад
    XCTAssertEqual(Horo.lenGesture(len0: g.len0, turn: g.turn).len, 15)
    var h = (len0: 3, turn: -5 * 2 * Double.pi)               // и вниз за предел 1
    let b = Horo.lenGesture(len0: h.len0, turn: h.turn)
    XCTAssertEqual(b.len, 1); h = (b.len0, b.turn)
    h.turn += step
    XCTAssertEqual(Horo.lenGesture(len0: h.len0, turn: h.turn).len, 2)
    XCTAssertEqual(Horo.lenGesture(len0: 8, turn: 2.4 * step).len, 10)   // в пределах — без перебазировки
    XCTAssertEqual(Horo.lenGesture(len0: 8, turn: 2.4 * step).len0, 8)
  }

  func testUOfE() {
    XCTAssertEqual(Horo.uOfE(Horo.et), 0, accuracy: 1e-12)
    XCTAssertEqual(Horo.uOfE(1e-6), -3)
    XCTAssertEqual(Horo.eOfU(0), Horo.et)
  }

  func testNoteName() {
    XCTAssertEqual(Horo.noteName(40), "D#1")
    XCTAssertEqual(Horo.noteName(50), "G1")
    XCTAssertEqual(Horo.noteName(60), "B1")
    XCTAssertEqual(Horo.noteName(55), "A1")
    XCTAssertEqual(Horo.noteName(110), "A2")
  }

  func testNum2() {
    XCTAssertEqual(Horo.num2(2.4), "2.4")
    XCTAssertEqual(Horo.num2(12.0 / 7), "1.71")
    XCTAssertEqual(Horo.num2(4), "4")
  }

  func testRatio() {
    XCTAssertTrue(Horo.ratio(rings([]), F: 1) == ("quies", "tap a ring"))
    let r = Horo.ratio(rings([4, 5, 6]), F: 1)
    XCTAssertEqual(r.a, "IV : V : VI")
    XCTAssertEqual(r.b, "rhythmus · 4 · 5 · 6 ictus in circuitu · trias harmonica")
    XCTAssertEqual(Horo.ratio(rings([4, 5, 6]), F: 10).b, "tonus — trias harmonica · D#1 G1 B1")
    let u = Horo.ratio(rings([2, 3], under: [2]), F: 1)
    XCTAssertEqual(u.a, "1/II : III")
    XCTAssertEqual(u.b, "rhythmus · 3 · 6 ictus in circuitu · diapason")
    XCTAssertEqual(Horo.ratio(rings([5], under: [5]), F: 1).b, "rhythmus · 2.4 ictus in circuitu")
  }

  func testMOfAequalis() {
    let r = HoroRing(n: 5, on: true, under: false, phi: 0, lvl: 0)
    XCTAssertEqual(Horo.mOf(r, aequalis: 0), 5)
    XCTAssertEqual(Horo.mOf(r, aequalis: 1), pow(2, 28.0 / 12), accuracy: 1e-9)
  }

  func testGeo() {
    let G = HoroGeo(W: 390, H: 844, topY: 59, safeBot: 34)
    XCTAssertEqual(G.R, 169.51, accuracy: 0.01)
    XCTAssertEqual(G.cy, 260.51, accuracy: 0.01)
    XCTAssertEqual(G.r0, 28.82, accuracy: 0.01)
    XCTAssertEqual(G.dr, 16.96, accuracy: 0.01)
    XCTAssertEqual(G.strip.x0, 39, accuracy: 0.01)
    XCTAssertEqual(G.strip.x1, 351, accuracy: 0.01)
    XCTAssertEqual(G.strip.y, 532.02, accuracy: 0.01)
    XCTAssertEqual(G.piv.x, 195, accuracy: 0.01)
    XCTAssertEqual(G.piv.y, 676, accuracy: 0.01)
    XCTAssertEqual(G.L, 100, accuracy: 0.01)
    XCTAssertEqual(G.sun.x, 390, accuracy: 0.01)
    XCTAssertEqual(G.sun.y, 61, accuracy: 0.01)
    XCTAssertEqual(G.sun.r, 42, accuracy: 0.01)
    XCTAssertEqual(G.ringAt(G.cx, G.cy - G.ringR(3)), 3)
    XCTAssertNil(G.ringAt(G.cx, G.cy))
    XCTAssertNil(G.ringAt(G.cx + G.R + 20, G.cy))
    XCTAssertEqual(G.stripX(0.05), 39, accuracy: 0.01)
    XCTAssertEqual(G.stripX(120), 351, accuracy: 0.01)
    XCTAssertEqual(G.stripX(1e4), 351, accuracy: 0.01)
    XCTAssertEqual(G.uOfX(G.stripX(2), Ft: 100.0 / 240), log2(2 / (100.0 / 240)), accuracy: 1e-6)
  }

  func testMirrorParse() {
    var b = [Double](repeating: 0, count: 63)
    for k in 0..<5 { b[k] = 0.1 * Double(k + 1) }
    b[5] = 1; b[6] = 1.5; b[7] = 0.5; b[8] = 100; b[9] = 1; b[10] = 1; b[11] = 0.25; b[12] = 2; b[13] = 7; b[14] = 1
    b[33] = 1; b[34] = 1; b[35] = 0.5; b[36] = 0.7
    let m = HoroMirror(b, n: 63)!
    XCTAssertEqual(m.fx, [0.1, 0.2, 0.30000000000000004, 0.4, 0.5])
    XCTAssertTrue(m.run && m.strip && m.held && m.locked)
    XCTAssertEqual([m.u, m.uT, m.bpm, m.P, m.F, m.strikes], [1.5, 0.5, 100, 0.25, 2, 7])
    XCTAssertEqual(m.rings.count, 8)
    XCTAssertEqual(m.rings[3].n, 5)
    XCTAssertTrue(m.rings[3].on && m.rings[3].under)
    XCTAssertEqual(m.rings[3].phi, 0.5)
    XCTAssertEqual(m.rings[3].lvl, 0.7)
    XCTAssertFalse(m.rings[2].on)
    XCTAssertNil(HoroMirror(Array(b.prefix(62)), n: 62))
    XCTAssertEqual(HoroMirror().rings.map { $0.n }, Array(2...9))
  }

  // ---------- маятник ----------
  func testSwingStep() {
    var p = HoroPendulum()
    XCTAssertEqual(p.swing(from: 0.1, to: -0.1), [.step(0.25)])
    XCTAssertEqual(p.handSteps, 1)
    XCTAssertEqual(p.th, -0.1)
    XCTAssertEqual(p.swing(from: 0.1, to: 0.2), [])
    XCTAssertEqual(p.swing(from: 3.0, to: -3.0), [])
    XCTAssertEqual(p.handSteps, 1)
  }

  func testGrab() {
    var p = HoroPendulum(); p.spin = true
    XCTAssertEqual(p.grab(0.4), [.held(true)])
    XCTAssertTrue(p.held); XCTAssertFalse(p.spin); XCTAssertEqual(p.th, 0.4)
  }

  func testReleaseCatch() {
    var p = HoroPendulum()
    XCTAssertEqual(p.release(th: 0.1, om: 0.1), [.held(false), .stop])
    XCTAssertEqual(p.release(th: 0.3, om: 0), [.held(false), .stop])
  }

  func testReleaseThrow() {
    var p = HoroPendulum()
    let out = p.release(th: 0.6, om: 0)
    guard out.count == 2, out[0] == .held(false), case .run(let u) = out[1] else { return XCTFail("\(out)") }
    XCTAssertEqual(u, 1.7696, accuracy: 1e-3)
    XCTAssertFalse(p.spin)
  }

  func testReleaseOverTop() {
    var p = HoroPendulum()
    let out = p.release(th: 0, om: 15)
    guard out.count == 2, case .run(let u) = out[1] else { return XCTFail("\(out)") }
    XCTAssertTrue(u > 5.9 && u < 6.1)
    XCTAssertTrue(p.spin)
  }

  func testTap() {
    var p = HoroPendulum(); p.held = true
    XCTAssertEqual(p.tap(running: true, uT: 0), [.held(false), .stop])
    XCTAssertFalse(p.held)
    XCTAssertEqual(p.tap(running: false, uT: 0), [.held(false), .run(0)])
  }

  func testTickSwing() {
    var p = HoroPendulum()
    p.start(u: 0)
    let A = acos(1 - Horo.et)
    for _ in 0..<200 {
      p.tick(dt: 0.01, run: true, u: 0, F: 100.0 / 240)
      XCTAssertLessThanOrEqual(abs(p.th), A + 1e-9)
    }
    XCTAssertGreaterThan(abs(p.th), 0)
  }

  func testTickHang() {
    var p = HoroPendulum(); p.th = 0.5
    p.tick(dt: 1, run: false, u: 0, F: 0)
    XCTAssertEqual(p.th, 0.5 * exp(-3.0), accuracy: 1e-12)
  }

  func testSpinSettles() {
    var p = HoroPendulum()
    _ = p.release(th: 0, om: 15)
    XCTAssertTrue(p.spin)
    for _ in 0..<500 {                                   // через верх: th остаётся в [−π, π]
      p.tick(dt: 0.01, run: true, u: 6, F: 3)
      XCTAssertTrue(p.th >= -.pi && p.th <= .pi)
    }
    XCTAssertTrue(p.spin)
    let th0 = p.th, A = acos(1 - Horo.eOfU(0))
    p.tick(dt: 0.0, run: true, u: 0, F: 0.4)             // ход успокоился — переход в качание без скачка
    XCTAssertFalse(p.spin)
    XCTAssertEqual(p.th, A * sin(asin(max(-1, min(1, sin(th0) / A)))), accuracy: 1e-9)
    XCTAssertEqual(sin(p.th), sin(th0).clamped(A), accuracy: 1e-9)
  }
}

private extension Double {
  func clamped(_ A: Double) -> Double { Swift.max(-A, Swift.min(A, self)) }
}
