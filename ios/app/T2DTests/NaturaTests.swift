import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// плашка кувшинки, веер, действия, heard, пропажа кувшинок (view.js:302-328, 484-498; model.js:83-145)
final class NaturaTests: XCTestCase {
  private typealias A = Nat.Act
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private lazy var view = NaturaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, rng: { 0.5 })
  private var gone: [Int] = []

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.objGone = { [unowned self] i in self.gone.append(i) }
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало: демо, но места off — выключены, playing — играет
  private func mirror(off: [Int] = [], playing: Bool = false) -> [Double] {
    var b = [Double](repeating: 0, count: Nat.mirrorN)
    b[0] = playing ? 0 : -1; b[1] = playing ? 1 : 0; b[4] = 96; b[5] = 12
    for k in 0..<Nat.fxDef.count { b[7 + k] = Nat.fxDef[k] }
    for i in 0..<Nat.npad {
      let o = Nat.head + i * Nat.padN
      for k in 4...8 { b[o + k] = -1 }
      if let d = Nat.demo.first(where: { $0.i == i }), !off.contains(i) { b[o] = 1; b[o + 1] = Double(d.note); b[o + 2] = Double(d.wave) }
    }
    return b
  }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }

  func testSendOwns() {
    view.send(A.plant, 1, [4, 0])
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 10); XCTAssertEqual(rec.acts[0].i, 1); XCTAssertEqual(rec.acts[0].a, [4, 0])
    XCTAssertEqual(rec.acts[0].t, 0)
    XCTAssertTrue(view.pad(1).on)
    XCTAssertEqual(view.pad(1).note, 4)
  }

  func testLilySheet() {
    let s = view.lilySpec(3)                               // note 5, wave 0
    XCTAssertEqual(s.title, "lily 4 · " + natNoteName(110 * pow(2, 8.0 / 12)))
    XCTAssertEqual(s.obj, 3); XCTAssertNil(s.lfo)
    XCTAssertEqual(s.rows.map(\.key), ["form", "cutoff", "res", "att", "rel", "chance"])
    XCTAssertEqual(s.rows.map(\.label), ["wave", "cutoff", "res", "attack", "release", "chance"])
    XCTAssertEqual(s.rows.map(\.code), [-1, -1, -1, -1, -1, -1])
    XCTAssertEqual(s.get("form"), 0); XCTAssertEqual(s.get("chance"), 1); XCTAssertEqual(s.get("cutoff"), 0.62, accuracy: 1e-9)
    XCTAssertEqual(s.text("cutoff"), "(" + natHz(180 * pow(2, 0.62 * 6.6)) + ")")
    XCTAssertEqual(s.text("att"), "(" + natMs(Nat.attOf(0.08)) + ")")
    rec.acts.removeAll()
    s.set("cutoff", 0.4)
    XCTAssertEqual(kinds(), [A.plock, A.hear])
    XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [0, 0.4]); XCTAssertEqual(rec.acts[1].i, 3)
    XCTAssertEqual(s.text("cutoff"), natHz(180 * pow(2, 0.4 * 6.6)))
    XCTAssertEqual(s.get("cutoff"), 0.4, accuracy: 1e-9)
    rec.acts.removeAll()
    view.tick(now: 1.1, dt: 0.1)
    s.set("cutoff", 0.45)
    XCTAssertEqual(kinds(), [A.plock])                     // HEAR не чаще 0.26 с
    rec.acts.removeAll()
    s.set("form", 0.75)
    XCTAssertEqual(kinds(), [A.pwave, A.hear]); XCTAssertEqual(rec.acts[0].a, [3])
    rec.acts.removeAll()
    s.set("form", 0.8)
    XCTAssertFalse(kinds().contains(A.pwave))
    rec.acts.removeAll()
    s.set("chance", 0.52)
    XCTAssertEqual(rec.acts[0].kind, A.pchance); XCTAssertEqual(rec.acts[0].a, [0.5])
    XCTAssertEqual(s.text("chance"), "50%")
    rec.acts.removeAll()
    s.reset!("chance"); XCTAssertEqual(kinds(), [A.punlock]); XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [4])
    rec.acts.removeAll()
    s.reset!("cutoff"); XCTAssertEqual(kinds(), [A.punlock]); XCTAssertEqual(rec.acts[0].a, [0])
    rec.acts.removeAll()
    s.reset!("form"); XCTAssertEqual(kinds(), [])
  }

  func testLilySheetNoPad() {
    let s = view.lilySpec(1)                               // места 1 в демо нет
    rec.acts.removeAll()
    s.set("cutoff", 0.4); s.set("form", 0.5); s.reset!("chance")
    XCTAssertEqual(kinds(), [])
  }

  func testLilyNoHearWhilePlaying() {
    mirrorBuf = mirror(playing: true); view.tick(now: 2.0, dt: 0.016)
    let s = view.lilySpec(3)
    rec.acts.removeAll()
    s.set("res", 0.5)
    XCTAssertEqual(kinds(), [A.plock])
  }

  func testFan() {
    let f = view.fx!
    XCTAssertEqual(f.title, "aether"); XCTAssertEqual(f.hint, "FX — tap outside to close")
    XCTAssertEqual(f.rows.map(\.key), ["reverb", "delay", "time", "chorus", "chance"])
    XCTAssertEqual(f.rows.map(\.code), [0, 1, 2, 3, 8]); XCTAssertNil(f.lfo)
    f.set("chorus", 0.7)
    XCTAssertEqual(rec.acts.last?.kind, A.setfx); XCTAssertEqual(rec.acts.last?.i, 3); XCTAssertEqual(rec.acts.last?.a, [0.7])
    XCTAssertEqual(f.get("chorus"), 0.7, accuracy: 1e-9)
    XCTAssertEqual(f.text("chorus"), "70%")
    f.set("time", 0.5)
    XCTAssertEqual(f.text("time"), Nat.div(0.5).name)
    XCTAssertEqual(f.arc!(), 0.4, accuracy: 1e-9)
  }

  func testHeard() {
    heardQ = [[2, 5, 1, 5]]
    view.tick(now: 3.0, dt: 0.016)
    XCTAssertEqual(view.state.noteAt[5], 3.0); XCTAssertEqual(view.state.playedAt[5], 3.0)
    heardQ = [[2, 6]]
    view.idle()
    XCTAssertEqual(view.state.noteAt[6], -1e9)
    XCTAssertTrue(heardQ.isEmpty)
  }

  func testObjGone() {
    view.send(A.remove, 3, [])
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(gone, [3])
    view.tick(now: 1.2, dt: 0.016)
    XCTAssertEqual(gone, [3])
    mirrorBuf = mirror(off: [5]); view.tick(now: 2.0, dt: 0.016)   // отмена: в зеркале 5 нет
    XCTAssertEqual(gone.filter { $0 == 5 }.count, 1)
    gone.removeAll()
    view.clear()
    view.tick(now: 2.1, dt: 0.016)
    XCTAssertEqual(gone.sorted(), [0, 2, 3, 6, 8, 9, 11, 13])
    view.tick(now: 2.2, dt: 0.016)
    XCTAssertEqual(gone.count, 8)
  }

  func testDiceClear() {
    view.dice()
    XCTAssertEqual(kinds(), [A.dice, A.play]); XCTAssertEqual(rec.acts[1].a, [1])
    rec.acts.removeAll()
    mirrorBuf = mirror(playing: true); view.tick(now: 2.0, dt: 0.016)
    view.dice()
    XCTAssertEqual(kinds(), [A.dice])
    rec.acts.removeAll()
    view.clear()
    XCTAssertEqual(kinds(), [A.clear]); XCTAssertFalse(view.pad(0).on)
    XCTAssertEqual(view.objs, 0)
  }

  func testCorner() {
    let g = view.geo.sun
    XCTAssertEqual(g.x, 13); XCTAssertEqual(g.y, 52); XCTAssertEqual(g.r, 70)
    XCTAssertTrue(view.cornerHit(40, 80))
    XCTAssertFalse(view.cornerHit(40, 40))
    XCTAssertFalse(view.cornerHit(120, 120))
  }
}
