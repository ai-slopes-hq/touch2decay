import XCTest
@testable import T2D

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// связка мира: действия, плашки, веер, heard, пропажа корабликов, кровавая луна (view.js:108-143, 362-374; model.js:59-91)
final class PortusTests: XCTestCase {
  private typealias A = Por.Act
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private lazy var view = PortusView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, rng: { 0.5 })
  private var gone: [Int] = []

  override func setUp() {
    mirrorBuf = mirror(on: [2, 3, 5])
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.objGone = { [unowned self] i in self.gone.append(i) }
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало с умолчаниями PorMirror: на — места с корабликами, playing — играет
  private func mirror(on: [Int] = [], playing: Bool = false) -> [Double] {
    let m = PorMirror()
    var b = [Double](repeating: 0, count: Por.mirrorN)
    b[0] = playing ? 0 : -1; b[1] = playing ? 1 : 0; b[3] = m.bpm
    for k in 0..<3 { b[4 + k] = m.luna[k]; b[7 + k] = m.echo[k] }
    b[10] = m.buoy.u; b[11] = m.buoy.d
    for k in 0..<2 { b[12 + k] = m.fog[k] }
    for k in 0..<5 { b[14 + k] = m.pharos[k]; b[19 + k] = m.fx[k] }
    for j in on { let o = Por.head + j * Por.isleN; b[o] = 1; b[o + 1] = Double(j); b[o + 3] = 1 }
    return b
  }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }

  func testSendOwns() {
    view.send(A.place, 1, [4, 300])
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 0); XCTAssertEqual(rec.acts[0].i, 1); XCTAssertEqual(rec.acts[0].a, [4, 300])
    XCTAssertEqual(rec.acts[0].t, 0)
    XCTAssertTrue(view.isle(1).on)
    XCTAssertEqual(view.isle(1).p, 4)
  }

  func testWorldShape() {
    XCTAssertEqual(view.slot, 13); XCTAssertEqual(view.title, "Portus"); XCTAssertEqual(view.sub, "pharos · echo · nebula")
    XCTAssertEqual(view.legend.map(\.glyph), [.tap, .drag, .tap, .tap, .drag, .drag, .up, .tap, .hold, .tap])
    XCTAssertEqual(view.legend[9].does, "map of worlds")
    XCTAssertEqual(view.objs, 3)
    XCTAssertEqual(view.step, -1)
  }

  func testLunaSheet() {
    let s = view.lunaSpec
    XCTAssertEqual(s.title, "luna")
    XCTAssertEqual(s.rows.map(\.key), ["cut", "res", "env"])
    XCTAssertEqual(s.rows.map(\.label), ["cutoff", "resonance", "envelope"])
    XCTAssertEqual(s.rows.map(\.code), [5, 6, 7])
    XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.shape, 0); XCTAssertEqual(s.lfo?.keys, ["cut", "res", "env"])
    XCTAssertEqual(s.text("cut"), "\(Int(Horo.jsRound(porFc(0.42)))) Hz")
    XCTAssertEqual(s.text("res"), "35%")
    s.set("cut", 0.6)
    XCTAssertEqual(kinds(), [A.luna]); XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[0].a, [0.6])
    XCTAssertEqual(s.get("cut"), 0.6)
  }

  func testEchoSheet() {
    let s = view.echoSpec
    XCTAssertEqual(s.title, "echo")
    XCTAssertEqual(s.rows.map(\.key), ["time", "fb", "tone", "mix"])
    XCTAssertEqual(s.rows.map(\.label), ["time", "feedback", "dark", "send"])
    XCTAssertEqual(s.rows.map(\.code), [-1, 10, 8, 9])
    XCTAssertEqual(s.lfo?.shape, 1); XCTAssertEqual(s.lfo?.keys, ["fb", "tone", "mix"])
    XCTAssertEqual(s.get("time"), 0.25)
    XCTAssertEqual(s.get("fb"), (0.45 - 0.03) / 0.92, accuracy: 1e-12)
    XCTAssertEqual(s.text("time"), "3/16")
    XCTAssertEqual(s.text("tone"), "45%"); XCTAssertEqual(s.text("mix"), "60%")
    s.set("time", 0.8)
    XCTAssertEqual(rec.acts[0].kind, A.echo); XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[0].a, [3])
    s.set("tone", 0.3)
    XCTAssertEqual(rec.acts[1].i, 1); XCTAssertEqual(rec.acts[1].a, [0.3])
    s.set("fb", 1)
    XCTAssertEqual(rec.acts[2].i, 3); XCTAssertEqual(rec.acts[2].a, [1])
    XCTAssertEqual(s.text("fb"), "95%")                       // view.js:121: fbOf() = 0.15 + 0.84·0.95 = 0.948 — не больше 0.95
  }

  func testEchoEndless() {                                    // буй далеко: fbOf > 0.95 — endless
    var b = mirror(on: [2, 3, 5]); b[11] = 0.97; mirrorBuf = b
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.echoSpec.text("fb"), "endless")
  }

  func testFogPharosIsleSheets() {
    let f = view.fogSpec
    XCTAssertEqual(f.title, "nebula"); XCTAssertEqual(f.rows.map(\.key), ["amt", "size"]); XCTAssertEqual(f.rows.map(\.label), ["amount", "size"])
    XCTAssertEqual(f.rows.map(\.code), [11, 12]); XCTAssertEqual(f.lfo?.shape, 1)
    XCTAssertEqual(f.text("size"), "6.8 s"); XCTAssertEqual(f.text("amt"), "45%")
    f.set("amt", 0.5); XCTAssertEqual(rec.acts[0].kind, A.fog); XCTAssertEqual(rec.acts[0].i, 0)

    let p = view.pharosSpec
    XCTAssertEqual(p.title, "pharos")
    XCTAssertEqual(p.rows.map(\.key), ["chord", "oct", "len", "swing", "lvl"])
    XCTAssertEqual(p.rows.map(\.label), ["chord", "octave", "length", "swing", "level"])
    XCTAssertEqual(p.rows.map(\.code), [-1, -1, -1, -1, -1]); XCTAssertNil(p.lfo)
    XCTAssertEqual(p.get("chord"), 0.5); XCTAssertEqual(p.text("chord"), "m7")
    p.set("oct", 0.0)
    XCTAssertEqual(rec.acts[1].kind, A.pharos); XCTAssertEqual(rec.acts[1].i, 1); XCTAssertEqual(rec.acts[1].a, [-2])
    XCTAssertEqual(p.text("oct"), "octave −2")
    XCTAssertEqual(p.get("oct"), 0)
    p.set("chord", 0.5); XCTAssertEqual(rec.acts[2].i, 0); XCTAssertEqual(rec.acts[2].a, [2])
    p.set("len", 0.95); XCTAssertEqual(p.text("len"), "endless")
    p.set("len", 0.25); XCTAssertEqual(p.text("len"), "148 ms")
    XCTAssertEqual(p.text("lvl"), "80%"); XCTAssertEqual(p.text("swing"), "0%")
    rec.acts.removeAll()
    p.set("swing", 0.3); XCTAssertEqual(rec.acts[0].i, 4); XCTAssertEqual(rec.acts[0].a, [0.3])
    p.set("lvl", 0.6); XCTAssertEqual(rec.acts[1].i, 3); XCTAssertEqual(rec.acts[1].a, [0.6])
    XCTAssertEqual(p.get("swing"), 0.3); XCTAssertEqual(p.get("lvl"), 0.6)
    rec.acts.removeAll()
    p.set("oct", 1); XCTAssertEqual(p.text("oct"), "octave +2")

    let s = view.isleSpec(2)
    XCTAssertEqual(s.title, "navicula"); XCTAssertEqual(s.obj, 2); XCTAssertNil(s.lfo)
    XCTAssertEqual(s.rows.map(\.key), ["oct", "lvl"]); XCTAssertEqual(s.rows.map(\.label), ["octave", "level"])
    XCTAssertEqual(s.rows.map(\.code), [-1, -1])
    XCTAssertEqual(s.text("oct"), "as lighthouse · " + view.nameOf(2))
    XCTAssertEqual(s.get("oct"), 0.5)
    rec.acts.removeAll()
    s.set("oct", 1); XCTAssertEqual(rec.acts[0].kind, A.isle); XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[0].a, [0, 2])
    s.set("lvl", 0.4); XCTAssertEqual(rec.acts[1].a, [1, 0.4])
    XCTAssertEqual(s.text("lvl"), "40%")
    XCTAssertEqual(view.isleSpec(2).text("oct"), "+2 · " + view.nameOf(2))
    view.send(A.sink, 2); rec.acts.removeAll()
    s.set("lvl", 1); XCTAssertTrue(rec.acts.isEmpty)           // кораблика нет — ничего не шлём
    XCTAssertEqual(view.isleSpec(3).text("lvl"), "100%")
  }

  func testFan() {
    let s = view.fx!
    XCTAssertEqual(s.title, "aether"); XCTAssertEqual(s.hint, "FX — tap outside to close")
    XCTAssertEqual(s.rows.map(\.key), ["wow", "mare", "drive", "chance", "spread"])
    XCTAssertEqual(s.rows.map(\.code), [0, 1, 2, 4, 3])
    XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.shape, 1); XCTAssertEqual(s.lfo?.keys, ["wow", "mare", "drive", "chance", "spread"])
    XCTAssertEqual(s.text("mare"), "calm")
    XCTAssertEqual(s.text("wow"), "25%")
    s.set("drive", 0.7)
    XCTAssertEqual(rec.acts[0].kind, A.fx); XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[0].a, [0.7])
    s.set("chance", 0.5); XCTAssertEqual(rec.acts[1].i, 4)
    s.set("spread", 0.5); XCTAssertEqual(rec.acts[2].i, 3)
    s.set("mare", 0.4); XCTAssertEqual(s.text("mare"), "40%")
    XCTAssertEqual(s.arc?(), 0.7)
    mirrorBuf = mirror(on: [2, 3, 5]); view.tick(now: 5, dt: 0.016)
    XCTAssertEqual(s.arc?(), 0.25)
  }

  func testHeard() {
    mirrorBuf = mirror(on: [5])
    heardQ = [[1, 5, 1, 6]]
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.state.hitT[5], 2)
    XCTAssertEqual(view.state.hitT[6], -1e9)
    XCTAssertEqual(view.state.hits.count, 1)
    XCTAssertEqual(view.state.hits[0].dt, 3 * (60.0 / 120 / 4), accuracy: 1e-12)
    XCTAssertEqual(view.state.hits[0].fb, porFb(0.45), accuracy: 1e-12)
    heardQ = [[1, 5], [1, 5]]
    view.idle()
    XCTAssertEqual(view.state.hitT[5], 2); XCTAssertEqual(view.state.hits.count, 1)
    XCTAssertTrue(heardQ.isEmpty)
  }

  func testObjGone() {
    view.send(A.sink, 3); mirrorBuf = mirror(on: [2, 5])
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(gone, [3])
    view.tick(now: 1.2, dt: 0.016)
    XCTAssertEqual(gone, [3])
    view.send(A.move, 2, [9]); mirrorBuf = mirror(on: [5, 9])
    view.tick(now: 1.3, dt: 0.016)
    XCTAssertEqual(gone, [3, 2])
    XCTAssertTrue(view.isle(9).on)
    mirrorBuf = mirror(on: [9])                                // зеркало: кораблика 5 нет (отмена, кубик)
    view.tick(now: 1.4, dt: 0.016)
    XCTAssertEqual(gone, [3, 2, 5])
  }

  func testObjGoneClear() {
    view.clear()
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(gone.sorted(), [2, 3, 5])
    view.tick(now: 1.2, dt: 0.016)
    XCTAssertEqual(gone.count, 3)
  }

  func testDiceClear() {
    view.dice()
    XCTAssertEqual(kinds(), [A.dice, A.play]); XCTAssertEqual(rec.acts[1].a, [1])
    XCTAssertTrue(view.playing)
    rec.acts.removeAll()
    mirrorBuf = mirror(on: [2], playing: true); view.tick(now: 3, dt: 0.016)
    view.dice()
    XCTAssertEqual(kinds(), [A.dice])
    view.clear()
    XCTAssertEqual(kinds(), [A.dice, A.clear])
    XCTAssertFalse(view.isle(2).on)
  }

  func testAudition() {
    view.audition(5)
    XCTAssertEqual(kinds(), [A.audition]); XCTAssertEqual(rec.acts[0].i, 5)
    view.audition(5)                                           // чаще 0.14 с — нет
    XCTAssertEqual(kinds().count, 1)
    mirrorBuf = mirror(on: [5], playing: true); view.tick(now: 3, dt: 0.016)
    view.audition(5)                                           // играет — нет
    XCTAssertEqual(kinds().count, 1)
  }

  func testBloodMoon() {
    view.lfoBase = { obj, code in obj == -1 && code == 5 ? 0.8 : nil }
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.geo.moon.y, 117.78, accuracy: 0.01); XCTAssertEqual(view.geo.moon.lfo, 1)
    view.lfoBase = { _, _ in nil }
    view.tick(now: 3, dt: 0.016)
    XCTAssertEqual(view.geo.moon.lfo, -1); XCTAssertEqual(view.geo.moon.y, 187.092, accuracy: 0.01)
    view.lfoBase = { _, _ in .nan }
    view.tick(now: 4, dt: 0.016)
    XCTAssertEqual(view.geo.moon.lfo, -1); XCTAssertEqual(view.geo.moon.y, 187.092, accuracy: 0.01)
  }

  func testCornerNever() {
    XCTAssertFalse(view.cornerHit(CGFloat(view.geo.moon.x), CGFloat(view.geo.moon.y)))
  }

  func testRestoredResetsOwn() {
    view.send(A.place, 7, [1, 1])
    XCTAssertTrue(view.isle(7).on)
    view.restored()
    XCTAssertFalse(view.isle(7).on)
  }
}
