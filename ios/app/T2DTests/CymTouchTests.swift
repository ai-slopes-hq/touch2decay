import XCTest
@testable import T2D

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания Cymatica: кнопки, кольца, метки, удар (view.js:90-153, 201-287, 323-338)
final class CymTouchTests: XCTestCase {
  private typealias A = Cym.Act
  private typealias P = (x: Double, y: Double)
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private lazy var view = CymaticaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, seed: { 7 })
  private var opened: [SheetSpec] = []
  private let f1 = NSObject(), f2 = NSObject()

  // зеркало с умолчаниями; strikes — слоты с ударами, marks — места мелодии (x, y)
  private func mirror(f0: Double = 110, strikes: [Int] = [], marks: [Int: P] = [:], mlen: Int = 7, playing: Bool = false,
                      rec: Bool = false, stepRec: Bool = false, cursor: Int = -1) -> [Double] {
    var b = [Double](repeating: 0, count: Cym.mirrorN)
    b[32] = f0
    for (k, v) in [2.0 / 7, 0.5, 0.5, 0.25, 0.15, 0.75, 1].enumerated() { b[33 + k] = v }
    b[40] = 96; b[41] = playing ? 1 : 0; b[42] = rec ? 1 : 0; b[43] = 16; b[44] = Double(mlen)
    for i in 0..<Cym.slots { b[45 + 4 * i + 2] = 1 }
    for i in strikes { b[45 + 4 * i] = 1; b[45 + 4 * i + 1] = 0.8; b[45 + 4 * i + 3] = 1 }
    for (i, p) in marks { b[109 + 3 * i] = 1; b[109 + 3 * i + 1] = p.x; b[109 + 3 * i + 2] = p.y }
    b[158] = 0.3; b[159] = 0.5
    b[162] = 1; b[163] = 0.3; b[165] = Double(cursor); b[166] = stepRec ? 1 : 0
    return b
  }
  private func load(_ b: [Double]) { mirrorBuf = b; at(0.3) }   // дольше 0.25 с: своё значение гаснет, виден только мир

  override func setUp() {
    mirrorBuf = mirror()
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    view.tick(now: 1.0, dt: 0.016)
  }

  private var G: CymGeo { view.geo }
  private func F(_ o: NSObject, _ p: P, to q: P? = nil, touchTime: Double = 0) -> Finger {
    let q = q ?? p
    return Finger(id: ObjectIdentifier(o), x: CGFloat(q.x), y: CGFloat(q.y), x0: CGFloat(p.x), y0: CGFloat(p.y), t0: view.now, moved: false, touchTime: touchTime)
  }
  private func at(_ dt: Double) { view.tick(now: view.now + dt, dt: dt) }
  private func tap(_ o: NSObject, _ p: P) { view.down(F(o, p)); view.up(F(o, p)) }
  private func drag(_ o: NSObject, _ p: P, _ q: P) { view.down(F(o, p)); view.move(F(o, p, to: q)); view.up(F(o, p, to: q)) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func pt(_ x: Double, _ y: Double) -> P { (G.fromPlate(x, y).x, G.fromPlate(x, y).y) }   // точка пластины на экране
  private var play: P { (G.playX, G.ty) }
  private var recB: P { (G.recX, G.ty) }
  private var gridB: P { (G.gridX, G.ty) }
  private var driftB: P { (G.driftX, G.ty) }

  func testStrike() {
    view.down(F(f1, pt(0, -0.9), touchTime: 3.5)); view.up(F(f1, pt(0, -0.9)))
    XCTAssertEqual(kinds(), [A.strikeAt])
    XCTAssertEqual(rec.acts[0].a[0], 0, accuracy: 1e-9); XCTAssertEqual(rec.acts[0].a[1], -0.9, accuracy: 1e-9)
    XCTAssertEqual(rec.acts[0].t, 3.5)
    XCTAssertEqual(view.state.stars.count, 1)
    rec.acts.removeAll()
    load(mirror(f0: 880))                                       // центр: клетка за списком нот — молчит
    tap(f2, (G.cx, G.cy))
    XCTAssertEqual(kinds(), [])
    XCTAssertEqual(view.fingers.count, 0)
  }

  func testButtons() {
    tap(f1, play)
    XCTAssertEqual(kinds(), [A.cursor, A.play]); XCTAssertEqual(rec.acts[0].a, [-1]); XCTAssertEqual(rec.acts[1].a, [1])
    rec.acts.removeAll(); load(mirror())
    drag(f1, play, (play.x + 40, play.y))
    XCTAssertEqual(kinds(), [A.bpm]); XCTAssertEqual(rec.acts[0].a, [116])
    XCTAssertGreaterThan(view.bpmUntil, view.now)
    rec.acts.removeAll()
    tap(f1, recB)                                               // часы стоят — запись по шагам
    XCTAssertEqual(kinds(), [A.cursor, A.stepRec]); XCTAssertEqual(rec.acts[1].a, [1, 0, 0])
    rec.acts.removeAll(); load(mirror(playing: true))
    tap(f1, recB)
    XCTAssertEqual(kinds(), [A.cursor, A.rec]); XCTAssertEqual(rec.acts[1].a, [1])
    rec.acts.removeAll()
    tap(f1, gridB)
    XCTAssertEqual(kinds(), [A.grid]); XCTAssertEqual(rec.acts[0].a, [2])
    rec.acts.removeAll()
    view.down(F(f1, gridB)); at(0.43)
    XCTAssertEqual(kinds(), [A.comb])
    view.up(F(f1, gridB))
    XCTAssertEqual(kinds(), [A.comb])
  }

  // сдвинут — навсегда: ушёл и вернулся, всё равно не тап и не удержание
  func testMovedIsSticky() {
    view.down(F(f1, play)); view.move(F(f1, play, to: (play.x + 40, play.y))); view.move(F(f1, play)); view.up(F(f1, play))
    XCTAssertEqual(kinds(), [A.bpm, A.bpm])                     // назад к 96 — тоже темп; ни CURSOR, ни PLAY
    rec.acts.removeAll(); load(mirror())
    view.down(F(f1, gridB)); view.move(F(f1, gridB, to: (gridB.x + 15, gridB.y))); view.move(F(f1, gridB)); at(0.43)
    XCTAssertEqual(kinds(), [])
    view.up(F(f1, gridB))
    XCTAssertEqual(kinds(), [A.grid])                           // сетка: тап и после сдвига переключает (как в вебе), но без COMB
    rec.acts.removeAll()
    view.down(F(f1, driftB)); view.move(F(f1, driftB, to: (driftB.x + 15, driftB.y))); view.move(F(f1, driftB)); at(0.43)
    XCTAssertEqual(opened.count, 0)
    view.up(F(f1, driftB))
    XCTAssertEqual(kinds(), [])
  }

  func testDriftTapHold() {
    tap(f1, driftB)
    XCTAssertEqual(kinds(), [A.driftToggle]); XCTAssertEqual(opened.count, 0)
    rec.acts.removeAll()
    view.down(F(f1, driftB)); at(0.43); at(0.1)
    XCTAssertEqual(opened.map(\.title), ["luna"])
    view.up(F(f1, driftB))
    XCTAssertEqual(kinds(), [])
  }

  func testRhythmRing() {
    load(mirror(strikes: [4]))
    let s: P = (G.cx + 172, G.cy)
    tap(f1, s)
    XCTAssertEqual(rec.acts.map(\.kind), [A.beat]); XCTAssertEqual(rec.acts[0].i, 4)
    rec.acts.removeAll()
    drag(f1, s, (s.x + 35, s.y))                                // наружу — шанс уже 1
    XCTAssertEqual(kinds(), [])
    drag(f1, s, (s.x - 35, s.y))
    XCTAssertEqual(kinds(), [A.chanceAt]); XCTAssertEqual(rec.acts[0].i, 4); XCTAssertEqual(rec.acts[0].a, [0.5])
    XCTAssertEqual(view.chanceEdit?.i, 4)
    XCTAssertEqual(view.chance(4), 0.5)
  }

  func testLen() {
    func edge(_ s: Double, _ R: Double) -> P {
      let a = -Double.pi / 2 + s * Double.pi * 2 / 16
      return (G.cx + R * cos(a), G.cy + R * sin(a))
    }
    view.down(F(f1, edge(6.5, 160)))
    view.move(F(f1, edge(6.5, 160), to: edge(9.5, 160)))
    XCTAssertEqual(kinds(), [A.len]); XCTAssertEqual(rec.acts[0].i, 1); XCTAssertEqual(rec.acts[0].a, [10])
    view.up(F(f1, edge(6.5, 160), to: edge(9.5, 160)))
    XCTAssertEqual(kinds(), [A.len])
  }

  func testBeadNudge() {
    let b = view.base(), n = view.scl.degPerOct, ci = b + n + 2
    let c = cymCellCenter(ring: 1, sector: 2, n: n)
    load(mirror(marks: [2: c]))
    let s = G.slotXY(2, G.R1), a = CymGeo.slotAng(2)
    drag(f1, s, (s.x + 13 * cos(a), s.y + 13 * sin(a)))
    XCTAssertEqual(kinds(), [A.nudge]); XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[0].a, [Double(ci), 2])
    XCTAssertEqual(view.noteEdit?.i, 2)
    rec.acts.removeAll()
    tap(f1, s)
    XCTAssertEqual(kinds(), [A.cursor]); XCTAssertEqual(rec.acts[0].a, [2])
    rec.acts.removeAll(); load(mirror(marks: [2: c], playing: true))
    tap(f1, s)
    XCTAssertEqual(kinds(), [])
  }

  func testMark() {
    load(mirror(marks: [1: (0, -0.9)]))
    tap(f1, pt(0, -0.9))
    XCTAssertEqual(kinds(), [A.strike]); XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[0].a, [0, -0.9, 110, 1, 0.5, 0])
    XCTAssertEqual(view.markHot?.i, 1)
    rec.acts.removeAll()
    let s = pt(0, -0.9), q = pt(0.3, -0.7)
    drag(f1, s, q)
    XCTAssertEqual(kinds(), [A.strike, A.moveMark]); XCTAssertEqual(rec.acts[1].i, 1)
    XCTAssertEqual(rec.acts[1].a[0], 0.3, accuracy: 1e-9); XCTAssertEqual(rec.acts[1].a[1], -0.7, accuracy: 1e-9)
    rec.acts.removeAll(); load(mirror(marks: [1: (0, -0.9)]))
    drag(f1, s, pt(0, -1.2))
    XCTAssertEqual(kinds(), [A.strike, A.moveMark, A.dropMark]); XCTAssertEqual(rec.acts[2].i, 1)
  }

  func testMarkIgnoredWhileRec() {
    load(mirror(marks: [1: (0, -0.9)], playing: true, rec: true))
    tap(f1, pt(0, -0.9))
    XCTAssertEqual(kinds(), [A.strikeAt])
  }

  func testAwaySkip() {
    load(mirror(stepRec: true))
    tap(f1, (20, 200))
    XCTAssertEqual(kinds(), [A.skip])
    rec.acts.removeAll()
    drag(f1, (20, 200), (50, 200))
    XCTAssertEqual(kinds(), [A.cursor])
    rec.acts.removeAll(); load(mirror())
    tap(f1, (20, 200))
    XCTAssertEqual(kinds(), [A.cursor]); XCTAssertEqual(rec.acts[0].a, [-1])
  }

  func testButtonNotPaired() {
    view.down(F(f1, pt(0, -0.9)))
    tap(f2, play)
    XCTAssertEqual(kinds(), [A.strikeAt, A.cursor, A.play])
    XCTAssertNil(view.pair)
    view.up(F(f1, pt(0, -0.9)))
    rec.acts.removeAll(); load(mirror())
    view.down(F(f1, play))
    view.down(F(f2, pt(0, -0.9)))
    XCTAssertEqual(kinds(), [A.strikeAt])
    XCTAssertNil(view.pair)
  }

  func testRestoredMidDrag() {
    load(mirror(marks: [1: (0, -0.9)]))
    let m = pt(0, -0.9)
    view.down(F(f1, m))
    let n = rec.acts.count
    view.restored()
    view.move(F(f1, m, to: (m.x + 30, m.y))); view.up(F(f1, m, to: (m.x + 30, m.y)))
    view.down(F(f2, (G.cx + 160, G.cy)))
    view.move(F(f2, (G.cx + 160, G.cy), to: (G.cx, G.cy + 160))); view.up(F(f2, (G.cx + 160, G.cy), to: (G.cx, G.cy + 160)))
    XCTAssertEqual(rec.acts.count, n)
    XCTAssertEqual(view.fingers.count, 0)
  }
}
