import XCTest
@testable import T2D

final class PorMathTests: XCTestCase {
  let acc = 1e-6
  func geo() -> PorGeo { PorGeo(W: 390, H: 844, topY: 50, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: nil) }

  func testGeo() {
    let g = geo()
    XCTAssertEqual(g.top, 56, accuracy: acc); XCTAssertEqual(g.bot, 802, accuracy: acc)
    XCTAssertEqual(g.cx, 195, accuracy: acc); XCTAssertEqual(g.Ws, 390, accuracy: acc)
    XCTAssertEqual(g.fx0, 0, accuracy: acc); XCTAssertEqual(g.fx1, 390, accuracy: acc)
    XCTAssertEqual(g.hor, 279.8, accuracy: acc); XCTAssertEqual(g.qy, 736, accuracy: acc)
    XCTAssertEqual(g.Wh, 191, accuracy: acc)
    XCTAssertEqual(g.moon.x, 0, accuracy: acc); XCTAssertEqual(g.moon.y, 187.092, accuracy: acc)
    XCTAssertEqual(g.moon.r, 46, accuracy: acc); XCTAssertEqual(g.moon.lfo, -1, accuracy: acc)
    XCTAssertEqual(g.ph.x, 350, accuracy: acc); XCTAssertEqual(g.ph.y, 686, accuracy: acc)
    XCTAssertEqual(g.fogTop, 215.903, accuracy: acc)
    let b = PorGeo(W: 390, H: 844, topY: 50, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: 0.8)
    XCTAssertEqual(b.moon.y, 117.78, accuracy: acc); XCTAssertEqual(b.moon.lfo, 1, accuracy: acc)
    let p = PorGeo(W: 1024, H: 1366, topY: 24, safeBot: 20, cut: 0.42, fogAmt: 0.45, cutBase: nil)
    XCTAssertEqual(p.Ws, 834.52, accuracy: acc); XCTAssertEqual(p.fx0, 94.74, accuracy: acc)
    XCTAssertEqual(p.moon.x, 94.74, accuracy: acc); XCTAssertEqual(p.moon.y, 258.88, accuracy: acc)
    XCTAssertEqual(p.ph.x, 889.26, accuracy: acc); XCTAssertEqual(p.ph.y, 1222, accuracy: acc)
  }

  func testProject() {
    let g = geo()
    let a = g.P(0.35, 0.45)
    XCTAssertEqual(a.x, 251.86871, accuracy: acc); XCTAssertEqual(a.y, 395.426728, accuracy: acc)
    XCTAssertEqual(a.s, 0.460829, accuracy: acc); XCTAssertEqual(a.wb, 162.482028, accuracy: acc)
    let u = g.unP(a.x, a.y)
    XCTAssertEqual(u.u, 0.35, accuracy: acc); XCTAssertEqual(u.d, 0.45, accuracy: acc)
    let s0 = g.slotPt(0, 0)
    XCTAssertEqual(s0.x, 132.982116, accuracy: acc); XCTAssertEqual(s0.y, 699.504, accuracy: acc); XCTAssertEqual(s0.s, 0.942222, accuracy: acc)
    let s1 = g.slotPt(5, 7)
    XCTAssertEqual(s1.x, 243.275201, accuracy: acc); XCTAssertEqual(s1.y, 577.850667, accuracy: acc)
    let s2 = g.slotPt(15, 12)
    XCTAssertEqual(s2.x, 278.15981, accuracy: acc); XCTAssertEqual(s2.y, 334.544, accuracy: acc)
    let hit = g.slotAt(s1.x, s1.y)
    XCTAssertEqual(hit?.i, 5); XCTAssertEqual(hit?.p, 7)
    for i in 0..<16 {
      for p in [0, 6, 12] {
        let q = g.slotPt(i, Double(p)), h = g.slotAt(q.x, q.y)
        XCTAssertEqual(h?.i, i, "i \(i) p \(p)"); XCTAssertEqual(h?.p, p, "i \(i) p \(p)")
      }
    }
    XCTAssertNil(g.slotAt(195, 100)); XCTAssertNil(g.slotAt(10, 577.85))
    let m0 = g.markPt(0), m1 = g.markPt(15)
    XCTAssertEqual(m0.x, 117.104606, accuracy: acc); XCTAssertEqual(m0.y, 699.504, accuracy: acc)
    XCTAssertEqual(m1.x, 182.268886, accuracy: acc); XCTAssertEqual(m1.y, 334.544, accuracy: acc)
    XCTAssertEqual(Por.edge(-1, 0.45), -0.962718, accuracy: acc); XCTAssertEqual(Por.edge(1, 0.45), 0.985221, accuracy: acc)
    XCTAssertEqual(Por.edge(-1, 0.2), -0.371822, accuracy: acc); XCTAssertEqual(Por.edge(1, 0.05), 0.573106, accuracy: acc)
    XCTAssertTrue(g.inSea(s1.x, s1.y)); XCTAssertFalse(g.inSea(195, 270))
  }

  func testScale() {
    let n = PorScale(pcs: nil, root: 0)
    XCTAssertEqual(n.hz(0, oct: 0, pharosOct: 0), 110, accuracy: acc)
    XCTAssertEqual(n.hz(7, oct: 0, pharosOct: 0), 110 * pow(2, 7.0 / 12), accuracy: acc)
    XCTAssertEqual(n.hz(0, oct: 1, pharosOct: -1), 110, accuracy: acc)
    XCTAssertEqual(n.name(3, oct: 0, pharosOct: 0, chord: 2), "Cm7")
    let m = PorScale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)
    XCTAssertEqual(m.semi(1, oct: 0, pharosOct: 0), 0, accuracy: acc)
    XCTAssertEqual(m.semi(4, oct: 0, pharosOct: 0), 3, accuracy: acc)
    XCTAssertEqual(m.semi(7, oct: 0, pharosOct: 0), 7, accuracy: acc)
    let r = PorScale(pcs: [3, 5, 6, 8, 10, 11, 1], root: 3)
    XCTAssertEqual(r.semi(0, oct: 0, pharosOct: 0), 3, accuracy: acc)
    XCTAssertEqual(porFc(0.42), 90 * pow(2, 3.024), accuracy: acc)
    XCTAssertEqual(porFb(0.45), 0.528, accuracy: acc); XCTAssertEqual(porFb(1), 0.985, accuracy: acc)
    let e = 0.03 + (1.0 / 4) * (Por.edge(1, 0.45) - Por.edge(-1, 0.45) - 0.06) + Por.edge(-1, 0.45)
    XCTAssertEqual(porBuoyU(time: 1, d: 0.45), e, accuracy: acc)
    let b = porBuoy(u: 0.9, d: 0.99)
    XCTAssertEqual(b.d, 0.95, accuracy: acc)
    XCTAssertLessThanOrEqual(b.u, Por.edge(1, 0.95) - 0.03 + 1e-12)
    XCTAssertTrue((0.0...4.0).contains(b.time))
  }

  func testMirror() {
    var b = (0..<104).map { Double($0) + 0.25 }
    var m = PorMirror()
    XCTAssertTrue(m.load(b, n: 104))
    XCTAssertEqual(m.step, 0); XCTAssertEqual(m.voices, 2); XCTAssertEqual(m.bpm, 3.25, accuracy: acc)
    XCTAssertEqual(m.luna[1], b[5]); XCTAssertEqual(m.echo[2], b[9])
    XCTAssertEqual(m.buoy.u, b[10]); XCTAssertEqual(m.buoy.d, b[11])
    XCTAssertEqual(m.fog[1], b[13]); XCTAssertEqual(m.pharos[4], b[18])
    XCTAssertEqual(m.fx[2], b[21]); XCTAssertEqual(m.fx[4], b[23])
    XCTAssertEqual(m.isles[3].lvl, b[24 + 15 + 3]); XCTAssertEqual(m.isles[15].sd, b[24 + 75 + 4])
    XCTAssertTrue(m.isles[0].on)                  // 24.25 > 0.5
    b[0] = -1; b[1] = 0; b[24] = 0
    XCTAssertTrue(m.load(b, n: 104))
    XCTAssertEqual(m.step, -1); XCTAssertFalse(m.playing); XCTAssertFalse(m.isles[0].on)
  }

  func testMirrorShort() {
    var m = PorMirror()
    var b = [Double](repeating: 1, count: 104)
    XCTAssertTrue(m.load(b, n: 104))
    b = [Double](repeating: 7, count: 104)
    XCTAssertFalse(m.load(b, n: 103)); XCTAssertEqual(m.bpm, 1)
    b[3] = .nan; b[19] = 0.5
    XCTAssertTrue(m.load(b, n: 104)); XCTAssertEqual(m.bpm, 1); XCTAssertEqual(m.fx[0], 0.5)
    let d = PorMirror()
    XCTAssertTrue(d.isles.allSatisfy { !$0.on }); XCTAssertEqual(d.isles.count, 16); XCTAssertEqual(d.pharos[0], 2)
  }

  func testHeard() {
    var o: [Int] = []
    XCTAssertEqual(porHeard([1, 4, 1, 0], n: 4, into: &o), 2); XCTAssertEqual(o, [4, 0])
  }

  func testHeardBad() {
    func run(_ b: [Double]) -> [Int] { var o: [Int] = []; _ = porHeard(b, n: b.count, into: &o); return o }
    XCTAssertEqual(run([1, 16, 1, 3]), [3]); XCTAssertEqual(run([0, 2]), [])
    XCTAssertEqual(run([1]), []); XCTAssertEqual(run([1, .nan, 1, 5]), [5])
  }
}
