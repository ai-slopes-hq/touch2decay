import XCTest
@testable import T2D

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double])] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a)); return true }
}

// WorldTempo пяти миров-секвенсеров: пуск, темп, armed, сетка Cymatica, зеркало вне кадра (фон)
final class TempoTests: XCTestCase {
  private let rec = Rec()
  private var buf: [Double] = []
  private lazy var reader: (inout [Double]) -> Int = { [unowned self] b in
    let n = min(self.buf.count, b.count); b.replaceSubrange(0..<n, with: self.buf[0..<n]); return n
  }
  private let noHeard: (inout [Double]) -> Int = { _ in 0 }

  // пустое зеркало нужной длины; set — правка (индекс, значение)
  private func mirror(_ n: Int, _ set: [(Int, Double)] = []) -> [Double] {
    var b = [Double](repeating: 0, count: n)
    for (i, v) in set { b[i] = v }
    return b
  }

  private func portus() -> PortusView { PortusView(core: rec, readMirror: reader, readHeard: noHeard, rng: { 0.5 }) }
  private func natura() -> NaturaView { NaturaView(core: rec, readMirror: reader, readHeard: noHeard, rng: { 0.5 }) }
  private func cymatica() -> CymaticaView { CymaticaView(core: rec, readMirror: reader, readHeard: noHeard, seed: { 7 }) }
  private func monochord() -> MonochordView { MonochordView(core: rec, readMirror: reader, readHeard: noHeard) }
  private func horologium() -> HorologiumView { HorologiumView(core: rec, readMirror: reader, readHeard: noHeard) }

  private let por = Por.mirrorN, nat = Nat.mirrorN, cym = Cym.mirrorN, mono = MonoMirror.size, horo = HoroMirror.size

  func testWorldTempoIsExposedOnlyBySequencers() {
    XCTAssertNotNil(portus().tempo); XCTAssertNotNil(natura().tempo); XCTAssertNotNil(cymatica().tempo)
    XCTAssertNotNil(monochord().tempo); XCTAssertNotNil(horologium().tempo)
    XCTAssertNil(InfernoView(core: rec).tempo)
  }

  private func check(_ t: WorldTempo, play: Int, bpm: Int, bpmI: Int = 0, file: StaticString = #filePath, line: UInt = #line) {
    t.play(true)
    XCTAssertEqual(rec.acts.count, 1, file: file, line: line)
    XCTAssertEqual(rec.acts.last?.kind, play, file: file, line: line)
    XCTAssertEqual(rec.acts.last?.a.first, 1, file: file, line: line)
    t.setBpm(97)
    XCTAssertEqual(rec.acts.count, 2, file: file, line: line)
    XCTAssertEqual(rec.acts.last?.kind, bpm, file: file, line: line)
    XCTAssertEqual(rec.acts.last?.i, bpmI, file: file, line: line)
    XCTAssertEqual(rec.acts.last?.a, [97], file: file, line: line)
  }

  func testPlayAndBpmCodes() {
    buf = mirror(por); check(portus(), play: 13, bpm: 10); rec.acts = []
    buf = mirror(nat); check(natura(), play: 1, bpm: 21); rec.acts = []
    buf = mirror(cym); check(cymatica(), play: 8, bpm: 14); rec.acts = []
    buf = mirror(mono); check(monochord(), play: MonochordView.Act.auto, bpm: MonochordView.Act.autopar, bpmI: 1); rec.acts = []
    buf = mirror(horo); check(horologium(), play: 2, bpm: 5)
  }

  func testHorologiumStopSendsRunZeroWithMirrorU() {
    buf = mirror(horo, [(5, 1), (6, 2.5)])           // run = 1, u = 2.5
    let v = horologium(); v.refresh(now: 1)
    v.play(true)
    XCTAssertEqual(rec.acts.last?.a, [1, 2.5])
    v.play(false)
    XCTAssertEqual(rec.acts.last?.kind, 2)
    XCTAssertEqual(rec.acts.last?.a, [0, 2.5])
    XCTAssertTrue(v.playing)                         // своих значений нет: пока зеркало не сменилось
  }

  func testArmed() {
    buf = mirror(por); let p = portus(); p.refresh(now: 1); XCTAssertFalse(p.armed)
    buf = mirror(por, [(Por.head, 1)]); p.refresh(now: 2); XCTAssertTrue(p.armed)
    buf = mirror(nat); let n = natura(); n.refresh(now: 1); XCTAssertFalse(n.armed)
    buf = mirror(nat, [(Nat.head, 1)]); n.refresh(now: 2); XCTAssertTrue(n.armed)
    buf = mirror(cym); let c = cymatica(); c.refresh(now: 1); XCTAssertFalse(c.armed)
    buf = mirror(cym, [(43, 16), (45 + 4 * 3, 1)]); c.refresh(now: 2); XCTAssertTrue(c.armed)
    buf = mirror(mono); let m = monochord(); m.refresh(now: 1); XCTAssertFalse(m.armed)
    buf = mirror(mono, [(9, 1)]); m.refresh(now: 2); XCTAssertFalse(m.armed)       // auto идёт — всё равно false
    buf = mirror(horo); let h = horologium(); h.refresh(now: 1); XCTAssertFalse(h.armed)
    buf = mirror(horo, [(15 + 5 * 2, 1)]); h.refresh(now: 2); XCTAssertTrue(h.armed)
  }

  func testMonochordAndHorologiumReadFromMirror() {
    buf = mirror(mono, [(9, 1), (10, 123)])
    let m = monochord(); m.refresh(now: 1)
    XCTAssertTrue(m.playing); XCTAssertEqual(m.bpm, 123)
    buf = mirror(horo, [(5, 1), (8, 140)])
    let h = horologium(); h.refresh(now: 1)
    XCTAssertTrue(h.playing); XCTAssertEqual(h.bpm, 140)
  }

  func testCymaticaGridSentOnlyOnChange() {
    buf = mirror(cym); let c = cymatica()
    c.grid(nil); XCTAssertEqual(rec.acts.count, 0)                 // ничего не слали — и выключать нечего
    let g = MidiGrid(t0: 12.5, p: 0.125)
    c.grid(g); c.grid(g)
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 4); XCTAssertEqual(rec.acts[0].a, [0, 12.5, 0.125])
    c.grid(MidiGrid(t0: 13, p: 0.125)); XCTAssertEqual(rec.acts.count, 2)
    c.grid(nil)
    XCTAssertEqual(rec.acts.count, 3); XCTAssertEqual(rec.acts[2].a, [1, 0, 0])
    c.grid(MidiGrid(t0: 1, p: 0)); XCTAssertEqual(rec.acts.count, 3)   // p ≤ 0 — не сетка
  }

  func testOtherWorldsIgnoreGrid() {
    buf = mirror(por); portus().grid(MidiGrid(t0: 1, p: 1))
    XCTAssertEqual(rec.acts.count, 0)
  }

  // фон: кадров нет, своё (оптимистичное) значение протухает по now из refresh
  func testBackgroundRefreshExpiresOwnValues() {
    buf = mirror(por); let p = portus(); p.refresh(now: 1)
    p.play(true); XCTAssertTrue(p.playing)
    p.refresh(now: 6); XCTAssertFalse(p.playing)
    buf = mirror(nat); let n = natura(); n.refresh(now: 1)
    n.play(true); XCTAssertTrue(n.playing)
    n.refresh(now: 6); XCTAssertFalse(n.playing)
    buf = mirror(cym); let c = cymatica(); c.refresh(now: 1)
    c.play(true); XCTAssertTrue(c.playing)
    c.refresh(now: 6); XCTAssertFalse(c.playing)
    buf = mirror(mono, [(9, 1)]); let m = monochord(); m.refresh(now: 1); XCTAssertTrue(m.playing)
    buf = mirror(mono); m.refresh(now: 6); XCTAssertFalse(m.playing)
    buf = mirror(horo, [(5, 1)]); let h = horologium(); h.refresh(now: 1); XCTAssertTrue(h.playing)
    buf = mirror(horo); h.refresh(now: 6); XCTAssertFalse(h.playing)
  }

  func testCymaticaPlayIsNoOpWhenAlreadyPlaying() {
    buf = mirror(cym); let c = cymatica(); c.refresh(now: 1)
    c.play(true); c.play(true)
    XCTAssertEqual(rec.acts.count, 1)                              // как tempo.play веба: on !== seq.playing
  }
}
