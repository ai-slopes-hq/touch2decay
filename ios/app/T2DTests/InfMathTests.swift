import XCTest
@testable import T2D

final class InfMathTests: XCTestCase {
  let acc = 1e-9
  func geo() -> InfGeo { InfGeo(W: 390, H: 844, topY: 50, safeBot: 34) }

  func testGeo() {
    let g = geo()
    XCTAssertEqual(g.top, 56, accuracy: acc); XCTAssertEqual(g.bot, 802, accuracy: acc)
    XCTAssertEqual(g.cx, 195, accuracy: acc); XCTAssertEqual(g.Ws, 390, accuracy: acc)
    XCTAssertEqual(g.y0, 152, accuracy: acc); XCTAssertEqual(g.yC, 748, accuracy: acc)
    XCTAssertEqual(g.dy, 596 / 9.3, accuracy: acc)
    XCTAssertEqual(g.rings.count, 9)
    XCTAssertEqual(g.rings[0].cy, 152, accuracy: acc); XCTAssertEqual(g.rings[0].rx, 179.4, accuracy: acc)
    XCTAssertEqual(g.rings[0].ry, 26.322, accuracy: acc)
    XCTAssertEqual(g.rings[8].rx, 50.7, accuracy: acc); XCTAssertEqual(g.rings[4].rx, 115.05, accuracy: acc)
    XCTAssertEqual(g.coc.cy, 748, accuracy: acc); XCTAssertEqual(g.coc.rx, 42.9, accuracy: acc)
    XCTAssertEqual(g.coc.ry, 9, accuracy: acc)
    XCTAssertEqual(g.dark.x, 0, accuracy: acc); XCTAssertEqual(g.dark.y, 810, accuracy: acc)
    XCTAssertEqual(g.dark.r, 109.2, accuracy: acc)
  }

  func testCircleAt() {
    let g = geo()
    XCTAssertEqual(g.circleAt(195, 152), 0)
    XCTAssertEqual(g.circleAt(195, 152 + g.dy * 0.6), 1)
    XCTAssertEqual(g.circleAt(195, 100), -1)
    XCTAssertEqual(g.circleAt(195 + 179.4 + 19, 152), -1)
    XCTAssertEqual(g.circleAt(195 + 179.4 + 19, 152, loose: true), 0)
    XCTAssertEqual(g.circleAt(195, 748 + 40), -1)
    XCTAssertEqual(g.posAt(0, 195), 0.5, accuracy: acc)
    XCTAssertEqual(g.posAt(0, 0), 0); XCTAssertEqual(g.posAt(0, 400), 1)
    XCTAssertEqual(g.at(4, 0.25).x, 195 - 115.05 / 2, accuracy: acc)
    XCTAssertEqual(g.at(4, 0.25).y, g.rings[4].cy, accuracy: acc)
  }

  func testSemiNote() {
    XCTAssertEqual(infSemi(8, 0, pcs: nil), 0)
    XCTAssertEqual(infSemi(8, 0.5, pcs: nil), 3.3333, accuracy: 1e-3)
    XCTAssertEqual(infSemi(0, 0.5, pcs: nil), 56.6667, accuracy: 1e-3)
    XCTAssertEqual(infNote(0), "A1"); XCTAssertEqual(infNote(56.6667), "F#6"); XCTAssertEqual(infNote(3), "C2")
    let pcs = [0, 2, 3, 5, 7, 8, 10]
    XCTAssertEqual(infSnap(1, pcs: pcs), 0)
    XCTAssertEqual(infSnap(6, pcs: pcs), 5)
    XCTAssertEqual(infSemi(8, 0.15, pcs: pcs), 0)
  }

  func testSheet() {
    let c = InfCirc(pos: 0.5, sinner: false, held: 0, color: 2, width: 0.4, drive: 0.15, level: 0.7, lvl: 0)
    XCTAssertEqual(InfSheet.get("color", c), 0.5)
    for k in 0...4 {                                       // как view.js:112 — середина ведра
      var q = c; q.color = k
      XCTAssertEqual(InfSheet.get("color", q), (Double(k) + 0.5) / 5, accuracy: 1e-12)
      XCTAssertEqual(InfSheet.set("color", InfSheet.get("color", q)).1, Double(k), accuracy: 1e-12)
    }
    XCTAssertEqual(InfSheet.get("width", c), 0.4); XCTAssertEqual(InfSheet.get("width", c), 0.4)
    XCTAssertTrue(InfSheet.set("color", 0.99) == (4, 4)); XCTAssertTrue(InfSheet.set("color", 0.5) == (4, 2))
    XCTAssertTrue(InfSheet.set("pos", 0.3) == (0, 0.3)); XCTAssertTrue(InfSheet.set("level", 0.6) == (3, 0.6))
    XCTAssertEqual(InfSheet.text("color", c, k: 0, pcs: nil), "brown")
    XCTAssertEqual(InfSheet.text("width", c, k: 0, pcs: nil), "40%")
    XCTAssertEqual(InfSheet.text("pos", c, k: 8, pcs: nil), infNote(infSemi(8, 0.5, pcs: nil)))
    XCTAssertEqual(InfSheet.rowCodes, [0, -1, 1, 2, 3])
    XCTAssertEqual(InfSheet.rowKeys, ["pos", "color", "width", "drive", "level"])
  }

  func testFanText() {
    XCTAssertEqual(InfSheet.fanText("structure", 0.2), "harmonic")
    XCTAssertEqual(InfSheet.fanText("structure", 0.5), "scale")
    XCTAssertEqual(InfSheet.fanText("structure", 0.9), "metal")
    XCTAssertEqual(InfSheet.fanText("storm", 0.01), "off")
    XCTAssertEqual(InfSheet.fanText("storm", 0.6), "60%")
    XCTAssertEqual(InfSheet.fanText("fire", 0.2), "20%")
  }

  func testMirror() {
    var b = [Double](repeating: 0, count: 81)
    for i in 0..<81 { b[i] = Double(i) + 0.5 }
    b[9 + 1] = 1; b[9 + 8 + 1] = 0
    b[9 + 24 + 2] = 3; b[9 + 24 + 3] = 4
    var m = InfMirror()
    XCTAssertTrue(m.load(b, n: 81))
    XCTAssertEqual(m.time, 0.5); XCTAssertEqual(m.iceE, 1.5); XCTAssertEqual(m.stormSemi, 2.5); XCTAssertEqual(m.stormPh, 3.5)
    XCTAssertEqual(m.fx[2], b[6]); XCTAssertEqual(m.fx[0], b[4]); XCTAssertEqual(m.fx[4], b[8])
    XCTAssertEqual(m.circ[3].level, b[9 + 24 + 6]); XCTAssertEqual(m.circ[3].lvl, b[9 + 24 + 7])
    XCTAssertEqual(m.circ[3].pos, b[9 + 24]); XCTAssertEqual(m.circ[3].width, b[9 + 24 + 4]); XCTAssertEqual(m.circ[3].drive, b[9 + 24 + 5])
    XCTAssertEqual(m.circ[3].held, 3); XCTAssertEqual(m.circ[3].color, 4)
    XCTAssertTrue(m.circ[0].sinner); XCTAssertFalse(m.circ[1].sinner)
    XCTAssertEqual(m.circ[8].lvl, b[9 + 64 + 7])
  }

  func testMirrorShort() {
    var m = InfMirror()
    XCTAssertEqual(m.circ[7].color, 2); XCTAssertEqual(m.circ[8].drive, 0.79, accuracy: 1e-12)
    XCTAssertEqual(m.fx, Inf.fxDef)
    XCTAssertFalse(m.load([Double](repeating: 9, count: 96), n: 80))
    XCTAssertEqual(m.fx, Inf.fxDef); XCTAssertEqual(m.circ[7].color, 2); XCTAssertEqual(m.time, 0)
    XCTAssertFalse(m.load([Double](repeating: 9, count: 50), n: 81))
    XCTAssertEqual(m.fx, Inf.fxDef)
  }

  func heard(_ b: [Double]) -> (Int, [Int]) {
    var out: [Int] = []; out.reserveCapacity(16)
    let n = infHeard(b, n: b.count, into: &out)
    return (n, out)
  }

  func testHeard() {
    let r = heard([1, 4, 2, 0, 8])
    XCTAssertEqual(r.0, 3); XCTAssertEqual(r.1, [4, 0, 8])
  }

  func testHeardBad() {
    XCTAssertEqual(heard([2, 4]).0, 0)
    let r = heard([2, 4, 12, 1, 3])
    XCTAssertEqual(r.0, 2); XCTAssertEqual(r.1, [4, 3])
    XCTAssertEqual(heard([0, 1, 1]).0, 0)
    XCTAssertEqual(heard([1, .nan]).0, 0)
    XCTAssertEqual(heard([.nan, 1]).0, 0)
    XCTAssertEqual(heard([1e9, 1]).0, 0)
    XCTAssertEqual(heard([-1e300, 1]).0, 0)
  }
}
