import XCTest

final class ArcMathTests: XCTestCase {
  private let flat: (Double, Double) -> Double = { _, _ in 0 }

  func testGeo() {
    let g = ArcGeo(390, 844, 59, 34)
    XCTAssertEqual(g.top, 65, accuracy: 0.01); XCTAssertEqual(g.bot, 802, accuracy: 0.01)
    XCTAssertEqual(g.cx, 195, accuracy: 0.01); XCTAssertEqual(g.fx0, 7, accuracy: 0.01); XCTAssertEqual(g.fx1, 383, accuracy: 0.01)
    XCTAssertEqual(g.Wh, 178, accuracy: 0.01); XCTAssertEqual(g.hor, 190.29, accuracy: 0.01); XCTAssertEqual(g.gb, 762, accuracy: 0.01)
    XCTAssertEqual(g.EL, 80.04, accuracy: 0.01)
    XCTAssertEqual(g.sun.x, 390, accuracy: 0.01); XCTAssertEqual(g.sun.y, 61, accuracy: 0.01); XCTAssertEqual(g.sun.r, 42, accuracy: 0.01)
    var p = g.proj(0, -1); XCTAssertEqual(p.x, 195, accuracy: 0.01); XCTAssertEqual(p.y, 762, accuracy: 0.01); XCTAssertEqual(p.s, 1, accuracy: 0.01)
    p = g.proj(0, 1); XCTAssertEqual(p.y, 190.29, accuracy: 0.01); XCTAssertEqual(p.s, 0.2941, accuracy: 0.01)
    p = g.proj(0.5, 0); XCTAssertEqual(p.x, 284, accuracy: 0.01); XCTAssertEqual(p.y, 320.22, accuracy: 0.01); XCTAssertEqual(p.s, 0.4545, accuracy: 0.01)
    p = g.proj(-1, 0.5); XCTAssertEqual(p.x, 17, accuracy: 0.01); XCTAssertEqual(p.y, 241.34, accuracy: 0.01); XCTAssertEqual(p.s, 0.3571, accuracy: 0.01)
    let q = g.unproj(284, 500); XCTAssertEqual(q.u, 0.5, accuracy: 1e-3); XCTAssertEqual(q.v, -0.6015, accuracy: 1e-3)
    for u in stride(from: -0.7, through: 0.7, by: 0.1) {
      for v in stride(from: -0.9, through: 0.9, by: 0.1) {
        let a = g.proj(u, v), b = g.unproj(a.x, a.y)
        XCTAssertEqual(b.u, u, accuracy: 1e-5); XCTAssertEqual(b.v, v, accuracy: 1e-5)
      }
    }
    let k = g.pick(flat, 195, 500)!; XCTAssertEqual(k.u, 0, accuracy: 0.01); XCTAssertEqual(k.v, -0.6, accuracy: 0.01)
    XCTAssertNil(g.pick(flat, 195, 100))
    let hi = g.at({ _, _ in 0.5 }, 0.3, 0.2), lo = g.proj(0.3, 0.2)
    XCTAssertEqual(Double(lo.y - hi.y), g.EL * Double(lo.s) * 0.5, accuracy: 1e-3)
  }

  func testLoopPts() {
    let g = ArcGeo(390, 844, 59, 34)
    var buf = [CGPoint](repeating: .zero, count: 64)
    let n = g.loopPts(flat, fig: 0, u: 0, v: 0, r: 0.2, n: 48, into: &buf)
    XCTAssertEqual(n, 49); XCTAssertEqual(buf.count, 64)
    XCTAssertEqual(buf[0].x, buf[48].x, accuracy: 1e-9); XCTAssertEqual(buf[0].y, buf[48].y, accuracy: 1e-9)
    let c = g.proj(0, 0); XCTAssertEqual(buf[0].x, c.x + CGFloat(0.2 * g.Wh), accuracy: 1e-6)
    var b1 = buf, b2 = buf
    _ = g.loopPts(flat, fig: 1, u: 0, v: 0, r: 0.2, n: 48, into: &b1)
    _ = g.loopPts(flat, fig: 2, u: 0, v: 0, r: 0.2, n: 48, into: &b2)
    XCTAssertNotEqual(b1[5].y, buf[5].y); XCTAssertNotEqual(b2[5].x, b1[5].x)
    let f1 = Arc.figPt(1, .pi / 2); XCTAssertEqual(f1.0, 1, accuracy: 1e-12); XCTAssertEqual(f1.1, 0, accuracy: 1e-12)
    let f2 = Arc.figPt(2, 0.3); XCTAssertEqual(f2.0, sin(0.6), accuracy: 1e-12); XCTAssertEqual(f2.1, 0.8 * sin(0.9 + 0.7), accuracy: 1e-12)
  }

  func testBilDepthNote() {
    let z = [Float](repeating: 0.5, count: Arc.gx * Arc.gy)
    for (u, v) in [(-1.0, -1.0), (1.0, 1.0), (0.0, 0.0)] { XCTAssertEqual(Arc.bil(z, u, v), 0.5, accuracy: 1e-6) }
    XCTAssertEqual(Arc.depthOf(-1), 0, accuracy: 1e-12); XCTAssertEqual(Arc.depthOf(1), 1, accuracy: 1e-12)
    for (f, n) in [(55.0, "A1"), (110, "A2"), (220, "A3"), (440, "A4"), (65.41, "C2"), (82.41, "E2"), (27.5, "A0"), (233.08, "A#3")] {
      XCTAssertEqual(Arc.noteName(f), n)
    }
  }

  func testMirrorParse() {
    var b = [Double](repeating: 0, count: 80)
    for i in 0..<14 { b[9 + 28 + i] = Double(i + 1) }
    let m = ArcMirror(b, n: 65)!
    let s = m.slots[2]
    XCTAssertTrue(s.on); XCTAssertEqual(s.u, 2); XCTAssertEqual(s.v, 3); XCTAssertEqual(s.lvl, 9); XCTAssertEqual(s.f, 10); XCTAssertEqual(s.gain, 14)
    XCTAssertFalse(m.slots[0].on)
    XCTAssertNil(ArcMirror(b, n: 64))
    let z = ArcMirror([Double](repeating: 0, count: 80), n: 65)!
    XCTAssertTrue(z.slots.allSatisfy { !$0.on }); XCTAssertFalse(z.pending)
    XCTAssertEqual(ArcMirror().fx, [0.3, 0.35, 0, 0.35, 0, 0.6, 0.4])
  }

  func testPicBridge() {
    var pic: ArcPic?
    ArcPicLoader(queue: nil).load(seed: Arc.seed0) { pic = $0 }
    let p = pic!
    XCTAssertEqual(p.z.count, 12800)
    XCTAssertGreaterThanOrEqual(p.peaks.count, 1); XCTAssertGreaterThanOrEqual(p.lakes.count, 2); XCTAssertGreaterThanOrEqual(p.rivers.count, 2)
    for k in 0..<min(3, p.peaks.count) { XCTAssertFalse((p.peaks[k].name ?? "").isEmpty) }
    XCTAssertTrue(p.lakes.filter { !$0.pond }.allSatisfy { !($0.name ?? "").isEmpty })
    XCTAssertTrue(p.rivers.prefix(2).allSatisfy { !($0.name ?? "").isEmpty })
    let r = ArcPic.coreRoute(p, 0.1, 0.5, 3)
    XCTAssertFalse(r.isEmpty); XCTAssertEqual(r.count % 2, 0); XCTAssertEqual(r[0], 0.1)
    XCTAssertTrue(ArcPic.coreRoute(p, 0.1, 0.5, 1).isEmpty)
  }
}
