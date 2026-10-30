import XCTest

final class HoroMathTests: XCTestCase {
  private func rings(_ on: [Int], under: [Int] = []) -> [HoroRing] {
    (0..<Horo.nr).map { HoroRing(n: $0 + 2, on: on.contains($0 + 2), under: under.contains($0 + 2), phi: 0, lvl: 0.8) }
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
    var b = [Double](repeating: 0, count: 47)
    for k in 0..<5 { b[k] = 0.1 * Double(k + 1) }
    b[5] = 1; b[6] = 1.5; b[7] = 0.5; b[8] = 100; b[9] = 1; b[10] = 1; b[11] = 0.25; b[12] = 2; b[13] = 7; b[14] = 1
    b[15 + 12] = 1; b[15 + 13] = 1; b[15 + 14] = 0.5; b[15 + 15] = 0.7
    let m = HoroMirror(b, n: 47)!
    XCTAssertEqual(m.fx, [0.1, 0.2, 0.30000000000000004, 0.4, 0.5])
    XCTAssertTrue(m.run && m.strip && m.held && m.locked)
    XCTAssertEqual([m.u, m.uT, m.bpm, m.P, m.F, m.strikes], [1.5, 0.5, 100, 0.25, 2, 7])
    XCTAssertEqual(m.rings.count, 8)
    XCTAssertEqual(m.rings[3].n, 5)
    XCTAssertTrue(m.rings[3].on && m.rings[3].under)
    XCTAssertEqual(m.rings[3].phi, 0.5)
    XCTAssertEqual(m.rings[3].lvl, 0.7)
    XCTAssertFalse(m.rings[2].on)
    XCTAssertNil(HoroMirror(Array(b.prefix(46)), n: 46))
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
