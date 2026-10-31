import XCTest

final class TriaMathTests: XCTestCase {
  func testGeo() {
    let g = TriaGeo(W: 390, H: 844, topY: 50, safeBot: 34)
    XCTAssertEqual(g.top, 56, accuracy: 1e-9); XCTAssertEqual(g.bot, 802, accuracy: 1e-9)
    XCTAssertEqual(g.Ws, 390, accuracy: 1e-9); XCTAssertEqual(g.cx, 195, accuracy: 1e-9)
    XCTAssertEqual(g.cy, 402, accuracy: 1e-9); XCTAssertEqual(g.R, 179, accuracy: 1e-9)
    XCTAssertEqual(g.av.map { $0.x }, [90, 160, 230])
    for a in g.av { XCTAssertEqual(a.y, 772, accuracy: 1e-9); XCTAssertEqual(a.r, 19, accuracy: 1e-9) }
    XCTAssertEqual(g.plumb.x, 300, accuracy: 1e-9); XCTAssertEqual(g.plumb.y, 772, accuracy: 1e-9)
    XCTAssertEqual(g.sun.x, 0, accuracy: 1e-9); XCTAssertEqual(g.sun.y, 52, accuracy: 1e-9); XCTAssertEqual(g.sun.r, 56, accuracy: 1e-9)
    let u = g.unit(g.px(0.3, -0.4))
    XCTAssertEqual(u.x, 0.3, accuracy: 1e-9); XCTAssertEqual(u.y, -0.4, accuracy: 1e-9)
  }

  func testRest() {
    let p = Tria.rest(0)
    XCTAssertEqual(p.x, 0, accuracy: 1e-9); XCTAssertEqual(p.y, -0.5, accuracy: 1e-9)
    XCTAssertEqual(Tria.rest(1).x, cos(-Double.pi / 2 + 2 * Double.pi / 3) * 0.5, accuracy: 1e-9)
  }

  func testNote() {
    XCTAssertEqual(triaNote(110), "A2")
    XCTAssertEqual(triaNote(261.63), "C4")
    XCTAssertEqual(triaNote(55), "A1")
  }

  func testSheetRoundTrip() {
    for k in ["m", "semi", "level", "fixed"] {
      for v in [0.0, 0.25, 0.5, 1.0] {
        let s = TriaSheet.set(k, v)
        let g = TriaSheet.get(k, m: k == "m" ? s.value : 1, semi: k == "semi" ? s.value : 0,
                              level: k == "level" ? s.value : 0.8, fixed: k == "fixed" ? s.value >= 0.5 : false)
        let tol = k == "semi" ? 1.0 / 36 : k == "fixed" ? 0.5 : 1e-9
        XCTAssertEqual(g, v, accuracy: tol, "\(k) \(v)")
      }
    }
    XCTAssertEqual(TriaSheet.set("m", 0.5).value, 1.65, accuracy: 1e-9)
    XCTAssertEqual(TriaSheet.set("semi", 0.5).value, 6)
    XCTAssertEqual(TriaSheet.set("fixed", 0.5).value, 1)
    XCTAssertEqual(["m", "semi", "level", "fixed"].map { TriaSheet.set($0, 0.5).key }, [0, 1, 3, 2])
  }

  func testSheetText() {
    func t(_ k: String, m: Double = 1, semi: Double = 0, level: Double = 0.8, fixed: Bool = false, tonic: Int = 0) -> String {
      TriaSheet.text(k, m: m, semi: semi, level: level, fixed: fixed, tonic: tonic)
    }
    XCTAssertEqual(t("m", m: 1.65), "1.6"); XCTAssertEqual(t("m", m: 2), "2.0")
    XCTAssertEqual(t("semi", semi: 0, tonic: 3), triaNote(110 * pow(2, 3.0 / 12)))
    XCTAssertEqual(t("level", level: 0.8), "80%")
    XCTAssertEqual(t("fixed", fixed: true), "anchored"); XCTAssertEqual(t("fixed", fixed: false), "free")
  }

  func testFanText() {
    XCTAssertEqual(TriaSheet.fanText("decay", 0.005), "off")
    XCTAssertEqual(TriaSheet.fanText("decay", 0.3), "30%")
    XCTAssertEqual(TriaSheet.fanText("aspectus", 0.005), "rim only")
    XCTAssertEqual(TriaSheet.fanText("aspectus", 0.2), "one circle")
    XCTAssertEqual(TriaSheet.fanText("aspectus", 0.5), "circles · 4 rays")
    XCTAssertEqual(TriaSheet.fanText("aspectus", 0.9), "circles · 8 rays")
    XCTAssertEqual(TriaSheet.fanText("gravitas", 0.5), "50%")
  }

  func testDice() {
    var calls = 0
    let d = triaDice { calls += 1; return 0.5 }
    XCTAssertEqual(calls, 16); XCTAssertEqual(d.count, 18)
    XCTAssertEqual(d[0], -0.525, accuracy: 1e-9); XCTAssertEqual(d[1], 0, accuracy: 1e-9)
    XCTAssertEqual(d[2], 0, accuracy: 1e-9); XCTAssertEqual(d[3], 0, accuracy: 1e-9)
    XCTAssertEqual(d[4], 1.2, accuracy: 1e-9); XCTAssertEqual(d[5], 0)
    XCTAssertEqual([d[5], d[11], d[17]], [0, 5, 10])
  }

  func testMirror() {
    var b = [Double](repeating: 0, count: 64)
    for k in 0..<47 { b[k] = Double(k) + 0.5 }
    b[6] = 1; b[7] = 1; b[8] = 0; b[11 + 12 + 5] = 1
    var m = TriaMirror()
    XCTAssertTrue(m.load(b, n: 47))
    XCTAssertEqual(m.fx, [0.5, 1.5, 2.5, 3.5, 4.5, 5.5])
    XCTAssertTrue(m.still); XCTAssertTrue(m.lux); XCTAssertFalse(m.cadit)
    XCTAssertEqual(m.strikes, 9.5); XCTAssertEqual(m.encounters, 10.5)
    let q = m.bodies[1]
    XCTAssertEqual([q.x, q.y, q.vx, q.vy, q.m], [23.5, 24.5, 25.5, 26.5, 27.5])
    XCTAssertTrue(q.fixed); XCTAssertFalse(m.bodies[0].fixed)
    XCTAssertEqual([q.semi, q.level, q.amp, q.hz, q.pairK, q.trem], [29.5, 30.5, 31.5, 32.5, 33.5, 34.5])
    XCTAssertEqual(m.bodies[2].x, 35.5)
    var b2 = b; b2[9] = 99
    XCTAssertFalse(m.load(b2, n: 46)); XCTAssertEqual(m.strikes, 9.5)
  }

  func testHeard() {
    let b: [Double] = [1, 0, 0, 0.1, 0.2, 0.5,  2, 1, 3, 0.3, 0.4, 0.6, 2, 1, 0.5, 0.6, 0.7]
    var out: [TriaFlashRec] = []; out.reserveCapacity(30)
    XCTAssertEqual(triaHeard(b, n: b.count, into: &out), 3)
    XCTAssertEqual(out.map { $0.i }, [0, 1, 2]); XCTAssertEqual(out.map { $0.kind }, [0, 3, 1])
    XCTAssertEqual(out[0].x, 0.1, accuracy: 1e-12); XCTAssertEqual(out[0].q, 0.5, accuracy: 1e-12)
  }

  func testHeardBad() {
    var out: [TriaFlashRec] = []
    XCTAssertEqual(triaHeard([2, 0, 0, 0.1, 0.2, 0.5], n: 6, into: &out), 0)   // обрезана
    let b: [Double] = [1, 5, 0, 0, 0, 0,  1, 1, 2, 0.1, 0.2, 0.3]
    XCTAssertEqual(triaHeard(b, n: b.count, into: &out), 1)                    // плохая пропущена, следующая читается
    XCTAssertEqual(out.count, 1)
    XCTAssertEqual(triaHeard([0, 1, 1, 0, 0, 0, 0], n: 7, into: &out), 0)       // c == 0 — стоп
    XCTAssertEqual(out.count, 1)
    out = []
    XCTAssertEqual(triaHeard([1, 0, 4, 0, 0, 0], n: 6, into: &out), 0)         // kind вне 0…3 — пропуск
    let t: [Double] = [1, 0, 0, 0.1, 0.2, 0.3,  2, 1, 1, 0, 0, 0]
    XCTAssertEqual(triaHeard(t, n: t.count, into: &out), 1)                    // целая запись учтена, обрезанная — стоп
    XCTAssertEqual(out.count, 1)
    out = []
    let nan: [Double] = [1, .nan, 0, 0, 0, 0,  1, 0, .nan, 0, 0, 0,  .nan, 0, 0, 0, 0, 0,  1, 1, 1, 0, 0, 0]
    XCTAssertEqual(triaHeard(nan, n: nan.count, into: &out), 0)                // NaN в i / kind — пропуск, NaN в c — стоп, не падает
    XCTAssertEqual(triaNote(.nan), ""); XCTAssertEqual(triaNote(.infinity), ""); XCTAssertEqual(triaNote(0), "")
  }
}
