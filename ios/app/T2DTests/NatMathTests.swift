import XCTest
@testable import T2D

final class NatMathTests: XCTestCase {
  let acc = 1e-9
  func geo() -> NatGeo { NatGeo(W: 390, H: 844, topY: 50, safeBot: 34) }

  func testGeo() {
    let g = geo()
    XCTAssertEqual(g.ox, 0, accuracy: acc); XCTAssertEqual(g.W, 390, accuracy: acc)
    XCTAssertEqual(g.top, 76, accuracy: acc); XCTAssertEqual(g.bot, 770, accuracy: acc)
    XCTAssertEqual(g.h, 694, accuracy: acc); XCTAssertEqual(g.hor, 284.2, accuracy: acc)
    XCTAssertEqual(g.y1, 764, accuracy: acc)
    XCTAssertEqual(g.sun.x, 13, accuracy: acc); XCTAssertEqual(g.sun.y, 52, accuracy: acc); XCTAssertEqual(g.sun.r, 70, accuracy: acc)
    XCTAssertEqual(g.tree.x, 331.5, accuracy: acc); XCTAssertEqual(g.tree.y, 402.18, accuracy: acc)
    XCTAssertEqual(g.cloudY, 117.64, accuracy: acc)
    let r0 = g.river(0)
    XCTAssertEqual(r0.x, 171.6, accuracy: acc); XCTAssertEqual(r0.y, 284.2, accuracy: acc); XCTAssertEqual(r0.w, 46.8, accuracy: acc)
    let r1 = g.river(1)
    XCTAssertEqual(r1.x, 436.8, accuracy: acc); XCTAssertEqual(r1.y, 603.44, accuracy: acc); XCTAssertEqual(r1.w, 241.8, accuracy: acc)
    for t in [0.0, 0.3, 0.7, 1] {
      let r = g.river(t)
      XCTAssertEqual(r.nx, r.ty, accuracy: acc); XCTAssertEqual(r.ny, -r.tx, accuracy: acc)
      XCTAssertEqual(hypot(r.tx, r.ty), 1, accuracy: acc)
    }
    let p = NatGeo(W: 1024, H: 1366, topY: 24, safeBot: 20)
    XCTAssertEqual(p.W, 835, accuracy: acc); XCTAssertEqual(p.ox, 95, accuracy: acc)
  }

  func testRiverRoundTrip() {
    let g = geo()
    for i in 0..<16 {
      for note in [0, 7, 14] {
        let p = g.padXY(i, note)
        let o = g.onRiver(p.x, p.y)
        XCTAssertEqual(NatGeo.slotOf(o.t), i, "slot \(i) note \(note)")
        XCTAssertEqual(NatGeo.noteOf(o.q), note, "slot \(i) note \(note)")
        XCTAssertTrue(g.inRiver(p.x, p.y))
      }
    }
    XCTAssertFalse(g.inRiver(195, 100))
    XCTAssertEqual(g.padXY(0, 7).s, 0.6 + 0.8 * NatGeo.slotT(0), accuracy: acc)
  }

  func testPlaces() {
    let g = geo()
    XCTAssertEqual(g.sunAt(bpm: 96).y, 52, accuracy: acc)
    XCTAssertEqual(g.sunAt(bpm: 40).y, 52 + (284.2 - 52 - 24.5), accuracy: acc)
    XCTAssertEqual(g.sunAt(bpm: 200).y, 52, accuracy: acc)
    let pd = g.pond()
    XCTAssertEqual(pd.x, 140.4, accuracy: acc); XCTAssertEqual(pd.y, 764 - 79.81, accuracy: acc)
    XCTAssertEqual(pd.rx, 62.4, accuracy: acc); XCTAssertEqual(pd.ry, 19, accuracy: acc)
    XCTAssertEqual(g.bridgeT(len: 12), NatGeo.slotT(11) + 0.72 / 16 * 0.75, accuracy: acc)
    let pier = g.pier(), b0 = g.boat(phase: nil, len: 12, now: 0)
    XCTAssertEqual(b0.x, pier.x + 16, accuracy: acc); XCTAssertEqual(b0.y, pier.y + 3, accuracy: acc)
    XCTAssertEqual(b0.s, 0.8, accuracy: acc)
    let b1 = g.boat(phase: 0, len: 12, now: 0), a = g.river(Nat.t0).across(0)
    XCTAssertEqual(b1.x, a.x, accuracy: acc); XCTAssertEqual(b1.y, a.y - 2, accuracy: acc)
    XCTAssertEqual(b1.s, 0.75 + Nat.t0, accuracy: acc)
    let c = g.crown()
    XCTAssertEqual(c.R, min(0.16 * 390, 0.09 * 694), accuracy: acc)
    XCTAssertEqual(c.y, 402.18 - 0.13 * 694 - 0.6 * c.R, accuracy: acc)
    var bs: [(x: Double, y: Double, s: Double, i: Int, fast: Double)] = []
    g.birds(chorus: 0.5, now: 0, birdsAt: -100, into: &bs)
    XCTAssertEqual(bs.count, 8)
    let d = g.ducks(att: 0, rel: 1, now: 0)
    XCTAssertEqual(d.a.s, 12, accuracy: acc); XCTAssertEqual(d.r.s, 26, accuracy: acc)
    XCTAssertEqual(d.a.dir, 1); XCTAssertEqual(d.r.dir, -1)
  }

  func testScale() {
    let none = NatScale(pcs: nil, root: 0)
    XCTAssertEqual(none.noteHz(0), 110, accuracy: acc); XCTAssertEqual(none.noteHz(7), 220, accuracy: acc)
    XCTAssertEqual(none.noteHz(2), 110 * pow(2, 3.0 / 12), accuracy: acc)
    let lad = NatScale(pcs: [3, 5, 7, 8, 10, 0, 2], root: 3)
    XCTAssertEqual(lad.noteHz(0), 110 * pow(2, 3.0 / 12), accuracy: acc)
    XCTAssertEqual(lad.noteHz(1), 110 * pow(2, 5.0 / 12), accuracy: acc)   // ступени [0,2,4,5,7,9,11]
    XCTAssertEqual(lad.noteHz(6), 110 * pow(2, 14.0 / 12), accuracy: acc)
    XCTAssertEqual(none.skiffHz(0), none.noteHz(7), accuracy: acc)
    let d = (0.1 / 0.78 + 0.5) * 14
    let f = d - d.rounded(.down)
    let la = log2(none.noteHz(8)), lb = log2(none.noteHz(9))
    XCTAssertEqual(none.skiffHz(0.1), pow(2, la + f * (lb - la)), accuracy: 1e-7)
    let minor = NatScale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)
    XCTAssertEqual(minor.skiffHz(0.1), minor.noteHz(9), accuracy: acc)
    XCTAssertEqual(natNoteName(110), "A2"); XCTAssertEqual(natNoteName(261.63), "C4")
    XCTAssertEqual(natHz(180), "180 Hz"); XCTAssertEqual(natHz(1530), "1.5 kHz")
    XCTAssertEqual(natMs(0.05), "50 ms"); XCTAssertEqual(natMs(1.9), "1.90 s")
    XCTAssertEqual(Nat.div(0.5).name, "1/4"); XCTAssertEqual(Nat.div(0.4).name, "1/8d");   // JS: round(2.5) = 3
     XCTAssertEqual(Nat.div(1).beats, 2)
    XCTAssertEqual(Nat.attOf(1), 0.602, accuracy: acc); XCTAssertEqual(Nat.relOf(0), 0.05, accuracy: acc)
  }

  func buf() -> [Double] { (0..<160).map { Double($0) + 0.25 } }

  func testMirror() {
    var b = buf()
    b[1] = 1; b[16 + 9 * 2] = 1; b[16 + 9 * 2 + 3] = 1; b[5] = 7.0; b[16 + 9 * 2 + 1] = 9; b[16 + 9 * 2 + 2] = 3
    var m = NatMirror()
    XCTAssertTrue(m.load(b, n: 160))
    XCTAssertEqual(m.phase, 0.25, accuracy: acc); XCTAssertTrue(m.playing)
    XCTAssertEqual(m.voices, 2); XCTAssertEqual(m.skiffs, 3)
    XCTAssertEqual(m.bpm, 4.25, accuracy: acc); XCTAssertEqual(m.len, 7); XCTAssertEqual(m.shake, 6.25, accuracy: acc)
    XCTAssertEqual(m.fx[3], b[10], accuracy: acc); XCTAssertEqual(m.fx.count, 9)
    XCTAssertEqual(m.pads[2].lock[1], b[16 + 18 + 6], accuracy: acc)
    XCTAssertEqual(m.pads[2].lock[0], b[16 + 18 + 5], accuracy: acc)
    XCTAssertEqual(m.pads[2].lock[3], b[16 + 18 + 8], accuracy: acc)
    XCTAssertTrue(m.pads[2].on); XCTAssertTrue(m.pads[2].glide)
    XCTAssertEqual(m.pads[2].note, 9); XCTAssertEqual(m.pads[2].wave, 3)
    XCTAssertEqual(m.pads[2].chance, b[16 + 18 + 4], accuracy: acc)
    XCTAssertTrue(m.pads[3].on)   // b[16 + 27] = 43.25 > 0.5
  }

  func testMirrorShort() {
    var m = NatMirror()
    let before = m
    XCTAssertFalse(m.load(buf(), n: 159))
    XCTAssertEqual(m.pads, before.pads); XCTAssertEqual(m.bpm, 96); XCTAssertEqual(m.fx, before.fx)
    var b = buf(); b[4] = .nan; b[16 + 9 * 5 + 1] = .infinity
    XCTAssertTrue(m.load(b, n: 160))
    XCTAssertEqual(m.bpm, 96)
    XCTAssertEqual(m.pads[5].note, 11)
    XCTAssertEqual(m.phase, 0.25, accuracy: acc)
  }

  func testMirrorDefault() {
    let m = NatMirror()
    XCTAssertEqual(m.pads[5], NatPad(on: true, note: 11, wave: 2))
    XCTAssertFalse(m.pads[1].on); XCTAssertEqual(m.fx, Nat.fxDef); XCTAssertEqual(m.len, 12)
    XCTAssertEqual(m.phase, -1); XCTAssertEqual(m.pads.count, 16)
    XCTAssertEqual(m.pads[0].chanceV, 1); XCTAssertEqual(m.pads[0].lock, SIMD4<Double>(repeating: -1))
  }

  func testHeard() {
    var out: [(kind: Int, i: Int)] = []
    let n = natHeard([2, 4, 1, 4, 1, 0], n: 6, into: &out)
    XCTAssertEqual(n, 3)
    XCTAssertEqual(out.map { $0.kind }, [2, 1, 1]); XCTAssertEqual(out.map { $0.i }, [4, 4, 0])
  }

  func testHeardBad() {
    var out: [(kind: Int, i: Int)] = []
    XCTAssertEqual(natHeard([2, 16, 1, 3], n: 4, into: &out), 1)
    XCTAssertEqual(out.count, 1); XCTAssertEqual(out[0].kind, 1); XCTAssertEqual(out[0].i, 3)
    out = []
    XCTAssertEqual(natHeard([3, 1], n: 2, into: &out), 0)
    XCTAssertEqual(natHeard([2], n: 1, into: &out), 0)
    XCTAssertEqual(natHeard([1, .nan, 2, 5], n: 4, into: &out), 1)
    XCTAssertEqual(out.count, 1); XCTAssertEqual(out[0].kind, 2); XCTAssertEqual(out[0].i, 5)
  }
}
