import XCTest
@testable import T2D

final class CymMathTests: XCTestCase {
  let acc = 1e-6
  let flat = CymScale(pcs: nil, root: 0)
  let minor = CymScale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)

  func testNoteName() {
    XCTAssertEqual(Cym.noteName(110), "A2"); XCTAssertEqual(Cym.noteName(55), "A1")
    XCTAssertEqual(Cym.noteName(440 * pow(2, 1.0 / 12)), "A♯4")
    XCTAssertEqual(Cym.structs.count, 8); XCTAssertEqual(Cym.structs[2], "plate")
    XCTAssertEqual(Cym.echoDiv(0.75).0, "1/8d")
    XCTAssertEqual(Cym.driftRate(0.5).0, "1 bar")
    XCTAssertEqual(Cym.driftDepth(0.3), 2); XCTAssertEqual(Cym.driftDepth(0), 1)
  }

  func testNoteList() {
    let l = flat.noteList()
    XCTAssertEqual(l.count, 26); XCTAssertEqual(Array(l.prefix(8)), [0, 3, 5, 7, 10, 12, 15, 17]); XCTAssertEqual(l.last, 60)
    XCTAssertEqual(flat.semis().count, 21); XCTAssertEqual(flat.degPerOct, 5)
    let m = minor.noteList()
    XCTAssertEqual(m.count, 36); XCTAssertEqual(Array(m.prefix(9)), [0, 2, 3, 5, 7, 8, 10, 12, 14]); XCTAssertEqual(m.last, 60)
    XCTAssertEqual(minor.semis().count, 29); XCTAssertEqual(minor.degPerOct, 7)
    XCTAssertTrue(minor.on); XCTAssertFalse(flat.on)
  }

  func testCells() {
    let list = flat.noteList()
    let b = cymNearestIdx(list, 12)
    XCTAssertEqual(b, 5)
    XCTAssertEqual(cymCellIdx(0, -0.9, b: 5, n: 5), 5); XCTAssertEqual(cymCellIdx(0.5, 0, b: 5, n: 5), 16)
    XCTAssertEqual(cymCellIdx(0, 0, b: 5, n: 5), 15); XCTAssertEqual(cymCellIdx(0.1, 0.1, b: 5, n: 5), 16)
    XCTAssertNil(cymCellIdx(1.1, 0, b: 5, n: 5))
    XCTAssertEqual(cymNoteAt(0, -0.9, b: 5, n: 5, list: list), 12)
    XCTAssertEqual(cymNoteAt(0.5, 0, b: 5, n: 5, list: list), 39)
    XCTAssertEqual(cymNoteAt(0, 0, b: 5, n: 5, list: list), 36)
    let hi = cymNearestIdx(list, 12 * log2(880.0 / 55))
    XCTAssertEqual(hi, 20)
    XCTAssertNil(cymNoteAt(0, 0, b: hi, n: 5, list: list))
    let c = cymCellOf(12, b: 5, n: 5)
    XCTAssertEqual(c?.ring, 1); XCTAssertEqual(c?.sector, 2)
    XCTAssertNil(cymCellOf(4, b: 5, n: 5))
    let p = cymCellCenter(ring: 1, sector: 2, n: 5)
    XCTAssertEqual(p.x, 0, accuracy: 1e-9); XCTAssertEqual(p.y, 0.7, accuracy: 1e-9)
    for ring in 0...2 { for s in 0..<5 {
      let q = cymCellCenter(ring: ring, sector: s, n: 5)
      XCTAssertEqual(cymCellIdx(q.x, q.y, b: 5, n: 5), 5 + ring * 5 + s)
    } }
  }

  func testTwist() {
    func tp(_ a1: Double, _ d1: Double) -> CymTwo? { cymTwistOrPinch(a0: 0, a1: a1, d0: 100, d1: d1) }
    XCTAssertTrue(tp(0.2, 100) == CymTwo.twist)
    XCTAssertTrue(tp(0.1, 130) == CymTwo.pinch)
    XCTAssertNil(tp(0.1, 105))
    XCTAssertTrue(tp(0.3, 140) == CymTwo.pinch)
  }

  func testEffF0() {
    XCTAssertEqual(cymEffF0(f0: 110, driftOn: false, k: 2, scale: flat), 110, accuracy: acc)
    XCTAssertEqual(cymEffF0(f0: 110, driftOn: true, k: 2, scale: flat), 55 * pow(2, 17.0 / 12), accuracy: acc)
    XCTAssertEqual(cymEffF0(f0: 110, driftOn: true, k: -9, scale: flat), 55, accuracy: acc)
    XCTAssertEqual(cymEffF0(f0: 110, driftOn: true, k: 1, scale: minor), 55 * pow(2, 14.0 / 12), accuracy: acc)
    XCTAssertEqual(cymFs(110), 12, accuracy: acc)
    XCTAssertEqual(cymBase(12, scale: flat), 5)
  }

  func testGeo() {
    let g = CymGeo(W: 390, H: 844, topY: 50, safeBot: 34, shownF0: 110)
    XCTAssertEqual(g.cx, 195, accuracy: acc); XCTAssertEqual(g.cy, 410, accuracy: acc); XCTAssertEqual(g.rMax, 131, accuracy: acc)
    XCTAssertEqual(g.r, 110.157430, accuracy: acc); XCTAssertEqual(g.R1, 153, accuracy: acc); XCTAssertEqual(g.R2, 179, accuracy: acc)
    XCTAssertEqual(g.RM, 166, accuracy: acc); XCTAssertEqual(g.ty, 623, accuracy: acc)
    XCTAssertEqual(g.playX, 105, accuracy: acc); XCTAssertEqual(g.recX, 165, accuracy: acc)
    XCTAssertEqual(g.gridX, 225, accuracy: acc); XCTAssertEqual(g.driftX, 285, accuracy: acc)
    let p = CymGeo(W: 1024, H: 1366, topY: 24, safeBot: 20, shownF0: 110)
    XCTAssertEqual(p.cy, 665, accuracy: acc); XCTAssertEqual(p.rMax, 448, accuracy: acc)
    XCTAssertEqual(p.r, 376.721594, accuracy: acc); XCTAssertEqual(p.ty, 1195, accuracy: acc)
    XCTAssertEqual(g.slotOf(195, 410 - 160), 0, accuracy: acc)
    XCTAssertEqual(g.slotOf(195 + 160, 410), 4, accuracy: acc)
    XCTAssertEqual(g.slotOf(195, 570), 8, accuracy: acc)
    let s = g.slotXY(4, 100)
    XCTAssertEqual(s.x, 295, accuracy: acc); XCTAssertEqual(s.y, 410, accuracy: acc)
    let f = g.fromPlate(0.3, -0.2), t = g.toPlate(f.x, f.y)
    XCTAssertEqual(t.x, 0.3, accuracy: acc); XCTAssertEqual(t.y, -0.2, accuracy: acc)
    XCTAssertTrue(cymResonatorHit(380, 800, W: 390, H: 844, safeBot: 34))
    XCTAssertFalse(cymResonatorHit(300, 800, W: 390, H: 844, safeBot: 34))
  }

  func testMirror() {
    var b = [Double](repeating: 0, count: 175)
    for i in 0..<175 { b[i] = Double(i) + 0.25 }
    for i in [41, 42, 45, 48, 157, 166] { b[i] = 1 }   // on-флаги: playing, rec, rhythm[0].on, rhythm[0].has, drift.on, stepRec.on
    b[43] = 12; b[44] = 5; b[165] = 3; b[161] = -2; b[162] = 4
    var m = CymMirror()
    XCTAssertTrue(m.load(b, n: 175))
    XCTAssertEqual(m.energy[3], 3.25); XCTAssertEqual(m.voices[1].level, b[27]); XCTAssertEqual(m.voices[1].hz, b[26])
    XCTAssertEqual(m.f0, b[32]); XCTAssertEqual(m.fx[5], b[38]); XCTAssertEqual(m.fx.count, 7)
    XCTAssertEqual(m.bpm, b[40]); XCTAssertTrue(m.playing); XCTAssertTrue(m.rec)
    XCTAssertEqual(m.rlen, 12); XCTAssertEqual(m.mlen, 5)
    XCTAssertTrue(m.rhythm[0].on); XCTAssertEqual(m.rhythm[0].vel, b[46]); XCTAssertTrue(m.rhythm[0].has)
    XCTAssertEqual(m.rhythm[3].chance, b[45 + 12 + 2])
    XCTAssertEqual(m.melody[2].y, b[109 + 6 + 2]); XCTAssertEqual(m.melody[2].x, b[109 + 6 + 1])
    XCTAssertTrue(m.drift.on); XCTAssertEqual(m.drift.depth, b[158]); XCTAssertEqual(m.drift.k, -2)
    XCTAssertEqual(m.grid, 4); XCTAssertEqual(m.lastHit.x, b[163]); XCTAssertEqual(m.lastHit.y, b[164])
    XCTAssertEqual(m.cursor, 3); XCTAssertTrue(m.stepRec.on); XCTAssertEqual(m.stepRec.m, 168 - 168 + Int(b[168]))
  }

  func testMirrorShort() {
    var m = CymMirror()
    XCTAssertEqual(m.mlen, 7); XCTAssertEqual(m.cursor, -1); XCTAssertFalse(m.rhythm.contains { $0.on })
    var b = [Double](repeating: 0, count: 175)
    b[40] = 120
    XCTAssertFalse(m.load(b, n: 174)); XCTAssertEqual(m.bpm, 96)
    XCTAssertTrue(m.load(b, n: 175)); XCTAssertEqual(m.bpm, 120)
    b[40] = .nan
    XCTAssertTrue(m.load(b, n: 175)); XCTAssertEqual(m.bpm, 120)
  }

  func testHeard() {
    var out: [CymHeard] = []
    cymHeard([1, 3, 2, 0.5, 1, 2, 7, 0, 0, 0], n: 10, into: &out)
    XCTAssertEqual(out, [.step(r: 3, m: 2, hit: true), .answer(semi: 7)])
  }

  func testHeardBad() {
    var out: [CymHeard] = []
    cymHeard([1, 16, 2, 0, 1], n: 5, into: &out); XCTAssertTrue(out.isEmpty)
    cymHeard([3, 1, 1, 0, 0], n: 5, into: &out); XCTAssertTrue(out.isEmpty)
    cymHeard([1, 2, 3, 0], n: 4, into: &out); XCTAssertTrue(out.isEmpty)
    cymHeard([1, .nan, 1, 0, 1, 1, 4, 5, 0, 0], n: 10, into: &out)
    XCTAssertEqual(out, [.step(r: 4, m: 5, hit: false)])
  }
}
