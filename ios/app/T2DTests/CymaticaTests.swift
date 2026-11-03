import XCTest
@testable import T2D

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// связка мира: действия, веер, плашка луны, heard, вспышки рождения (view.js:351-357; model.js:66-80, 84-205)
final class CymaticaTests: XCTestCase {
  private typealias A = Cym.Act
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private lazy var view = CymaticaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, seed: { 7 })

  // зеркало с умолчаниями; strikes — слоты с ударами (сила 0.8), marks — слоты с местами мелодии
  private func mirror(strikes: [Int] = [], marks: [Int] = []) -> [Double] {
    var b = [Double](repeating: 0, count: Cym.mirrorN)
    b[32] = 110
    for (k, v) in [2.0 / 7, 0.5, 0.5, 0.25, 0.15, 0.75, 1].enumerated() { b[33 + k] = v }
    b[40] = 96; b[43] = 16; b[44] = 7
    for i in 0..<Cym.slots { b[45 + 4 * i + 2] = 1 }
    for i in strikes { b[45 + 4 * i] = 1; b[45 + 4 * i + 1] = 0.8; b[45 + 4 * i + 3] = 1 }
    for i in marks { b[109 + 3 * i] = 1; b[109 + 3 * i + 1] = 0.3; b[109 + 3 * i + 2] = 0.1 }
    b[158] = 0.3; b[159] = 0.5
    b[162] = 1; b[163] = 0.3; b[165] = -1
    return b
  }

  override func setUp() {
    mirrorBuf = mirror()
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.tick(now: 1.0, dt: 0.016)
  }

  func testSendOwns() {
    view.send(A.bpm, 0, [120])
    XCTAssertEqual(rec.acts.last!.kind, 14)
    XCTAssertEqual(rec.acts.last!.a, [120])
    XCTAssertEqual(rec.acts.last!.t, 0)
    XCTAssertEqual(view.bpm, 120)
    view.send(A.strikeAt, 0, [0.1, 0.2], touchTime: 3.5)
    XCTAssertEqual(rec.acts.last!.kind, 7)
    XCTAssertEqual(rec.acts.last!.t, 3.5)
  }

  func testFan() {
    let f = view.fx!
    XCTAssertEqual(f.title, "aether")
    XCTAssertEqual(f.rows.map { $0.key }, ["structure", "damping", "brightness", "hall", "echo", "chance", "time"])
    XCTAssertTrue(f.rows.allSatisfy { $0.code == -1 })
    XCTAssertEqual(f.text("structure"), "plate")
    XCTAssertEqual(f.text("damping"), "1.0 s")
    XCTAssertEqual(f.text("time"), "1/8d")
    XCTAssertEqual(f.text("echo"), "15%")
    f.set("time", 0.25)
    XCTAssertEqual(rec.acts.last!.kind, 27)
    XCTAssertEqual(rec.acts.last!.i, 5)
    XCTAssertEqual(rec.acts.last!.a, [0.25])
    XCTAssertEqual(f.arc!(), 0.25)
    XCTAssertNil(f.lfo)
  }

  func testDriftSheet() {
    let s = view.driftSpec
    XCTAssertEqual(s.title, "luna")
    XCTAssertEqual(s.rows.map { $0.key }, ["depth", "rate", "shape"])
    XCTAssertEqual(s.text("depth"), "±2 steps")
    XCTAssertEqual(s.text("rate"), "1 bar")
    XCTAssertEqual(s.text("shape"), "sine")
    s.set("rate", 1)
    XCTAssertEqual(rec.acts.last!.kind, 24)
    XCTAssertEqual(rec.acts.last!.i, 1)
    XCTAssertEqual(rec.acts.last!.a, [1])
    XCTAssertEqual(s.text("rate"), "1/4")
  }

  func testHeardTick() {
    mirrorBuf = mirror(strikes: [3], marks: [1])
    heardQ = [[1, 3, 1, 0, 1, 2, 12, 0, 0, 0]]
    view.tick(now: 2.0, dt: 0.016)
    XCTAssertEqual(view.state.pulse.r[3], 2.0)
    XCTAssertEqual(view.state.stars.count, 1)
    XCTAssertEqual(view.state.answerNote, "A2")
    heardQ = [[1, 3, 1, 0, 1]]
    view.idle()
    XCTAssertTrue(heardQ.isEmpty)
    XCTAssertEqual(view.state.pulse.r[3], 2.0)
    XCTAssertEqual(view.state.stars.count, 1)
  }

  func testBornViaTick() {
    XCTAssertLessThan(view.state.born.r[5], 0)
    mirrorBuf = mirror(strikes: [5])
    view.tick(now: 2.0, dt: 0.016)
    XCTAssertEqual(view.state.born.r[5], 2.0)
    view.restored()
    mirrorBuf = mirror(strikes: [5, 6])
    view.tick(now: 3.0, dt: 0.016)
    XCTAssertLessThan(view.state.born.r[6], 0)
  }

  func testDiceClear() {
    view.dice()
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 29)
    XCTAssertEqual(rec.acts[0].a, [7])
    view.clear()
    XCTAssertEqual(rec.acts.count, 2)
    XCTAssertEqual(rec.acts[1].kind, 30)
  }

  func testCorner() {
    XCTAssertTrue(view.cornerHit(380, 800))
    XCTAssertFalse(view.cornerHit(195, 410))
  }

  func testScale() {
    view.scale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)
    XCTAssertEqual(view.noteList.count, 36)
    view.scale(pcs: nil, root: 0)
    XCTAssertEqual(view.noteList.count, 26)
  }
}
