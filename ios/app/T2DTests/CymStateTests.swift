import XCTest
@testable import T2D

final class CymStateTests: XCTestCase {
  let M = CymMirror()
  let flat = CymScale(pcs: nil, root: 0)
  let minor = CymScale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)
  let acc = 1e-9
  typealias A = Cym.Act

  func testOwnNoLag() {
    var s = CymState()
    s.own(A.bpm, 0, [120], mirror: M, scale: flat, now: 1)
    XCTAssertEqual(s.bpm(mirror: M, now: 1.1), 120)
    XCTAssertEqual(s.bpm(mirror: M, now: 1.26), 96)
    var m2 = M; m2.bpm = 120
    XCTAssertEqual(s.bpm(mirror: m2, now: 1.05), 120)
    m2.bpm = 100                                                // своё снято — зеркало
    XCTAssertEqual(s.bpm(mirror: m2, now: 1.1), 100)
  }

  func testOwnPlayRec() {
    var s = CymState()
    s.own(A.rec, 0, [1], mirror: M, scale: flat, now: 1)
    XCTAssertTrue(s.rec(mirror: M, now: 1.1)); XCTAssertTrue(s.playing(mirror: M, now: 1.1))
    s.own(A.play, 0, [0], mirror: M, scale: flat, now: 1.1)
    XCTAssertFalse(s.playing(mirror: M, now: 1.12)); XCTAssertFalse(s.rec(mirror: M, now: 1.12))
    s.own(A.stepRec, 0, [1, 0, 0], mirror: M, scale: flat, now: 1.2)
    XCTAssertTrue(s.stepRec(mirror: M, now: 1.21).on); XCTAssertEqual(s.cursor(mirror: M, now: 1.21), -1)
    s.own(A.play, 0, [1], mirror: M, scale: flat, now: 1.3)
    XCTAssertFalse(s.stepRec(mirror: M, now: 1.31).on)
  }

  func testOwnLenChanceMark() {
    var s = CymState()
    s.own(A.len, 1, [5], mirror: M, scale: flat, now: 1)
    XCTAssertEqual(s.mlen(mirror: M, now: 1.1), 5); XCTAssertEqual(s.rlen(mirror: M, now: 1.1), 16)
    s.own(A.len, 0, [99], mirror: M, scale: flat, now: 1)       // за пределом — в 1…16
    XCTAssertEqual(s.rlen(mirror: M, now: 1.1), 16)
    s.own(A.chanceAt, 3, [0.4], mirror: M, scale: flat, now: 1)
    XCTAssertEqual(s.chance(3, mirror: M, now: 1.1), 0.4); XCTAssertEqual(s.chance(4, mirror: M, now: 1.1), 1)
    var m2 = M; m2.melody[2].on = true
    s.own(A.moveMark, 2, [0.1, -0.2], mirror: m2, scale: flat, now: 1)
    let k = s.mark(2, mirror: m2, now: 1.1)
    XCTAssertEqual(k.x, 0.1); XCTAssertEqual(k.y, -0.2); XCTAssertTrue(k.on)
    XCTAssertFalse(s.mark(2, mirror: M, now: 1.1).on)           // on — всегда зеркала
    s.own(A.moveMark, 99, [1, 1], mirror: M, scale: flat, now: 1)   // чужой индекс — ничего
    XCTAssertEqual(s.mark(99, mirror: M, now: 1.1), CymMark())
  }

  func testOwnF0() {
    var s = CymState()
    s.own(A.setF0, 0, [220], mirror: M, scale: flat, now: 1)
    XCTAssertEqual(s.f0(mirror: M, now: 1.1), 220, accuracy: 1e-6)
    s.own(A.setF0, 0, [2000], mirror: M, scale: flat, now: 1)
    XCTAssertEqual(s.f0(mirror: M, now: 1.1), 880, accuracy: 1e-6)
    s.own(A.setF0, 0, [57], mirror: M, scale: minor, now: 1)
    XCTAssertEqual(s.f0(mirror: M, now: 1.1), 55, accuracy: 1e-6)
    s.own(A.stepScale, 0, [12, 2], mirror: M, scale: flat, now: 2)
    XCTAssertEqual(s.f0(mirror: M, now: 2.1), 55 * pow(2, 17.0 / 12), accuracy: 1e-6)
    s.own(A.stepScale, 0, [12, -30], mirror: M, scale: flat, now: 3)
    XCTAssertEqual(s.f0(mirror: M, now: 3.1), 55, accuracy: 1e-6)
    s.own(A.stepScale, 0, [12, 1], mirror: M, scale: CymScale(pcs: [], root: 0), now: 4)   // пустой лад — не падает
    XCTAssertEqual(s.f0(mirror: M, now: 4.1), 110, accuracy: 1e-6)
  }

  func testOwnDriftFx() {
    var s = CymState()
    s.own(A.driftToggle, 0, [], mirror: M, scale: flat, now: 1)
    XCTAssertTrue(s.drift(mirror: M, now: 1.1).on)
    var m2 = M; m2.drift.on = true; m2.drift.k = 3
    s.own(A.driftToggle, 0, [], mirror: m2, scale: flat, now: 2)
    let d = s.drift(mirror: m2, now: 2.1)
    XCTAssertFalse(d.on); XCTAssertEqual(d.k, 3)               // k — всегда зеркала
    s.own(A.driftSet, 1, [0.9], mirror: M, scale: flat, now: 3)
    let e = s.drift(mirror: M, now: 3.1)
    XCTAssertEqual(e.rate, 0.9); XCTAssertTrue(e.on); XCTAssertEqual(e.depth, 0.3)
    s.own(A.setFx, 5, [0.2], mirror: M, scale: flat, now: 4)
    XCTAssertEqual(s.fx(5, mirror: M, now: 4.1), 0.2); XCTAssertEqual(s.fx(9, mirror: M, now: 4.1), 0)
    s.own(A.grid, 0, [4], mirror: M, scale: flat, now: 5)
    s.own(A.cursor, 0, [3], mirror: M, scale: flat, now: 5)
    XCTAssertEqual(s.grid(mirror: M, now: 5.1), 4); XCTAssertEqual(s.cursor(mirror: M, now: 5.1), 3)
    s.own(A.cursor, 0, [40], mirror: M, scale: flat, now: 6)
    XCTAssertEqual(s.cursor(mirror: M, now: 6.1), 15)
    s.own(A.strike, 0, [0, 0, 110, 1, 0, 0], mirror: M, scale: flat, now: 7)   // звук — не значения
    XCTAssertEqual(s.bpm(mirror: M, now: 7.1), 96)
  }

  func testMirrorClamps() {
    var m = M; m.rlen = 99; m.mlen = -4; m.grid = 0; m.cursor = 77
    let s = CymState()
    XCTAssertEqual(s.rlen(mirror: m, now: 0), 16); XCTAssertEqual(s.mlen(mirror: m, now: 0), 1)
    XCTAssertEqual(s.grid(mirror: m, now: 0), 1); XCTAssertEqual(s.cursor(mirror: m, now: 0), 15)
  }

  func testBorn() {
    let list = flat.noteList(), n = 5, b = 5
    var s = CymState()
    s.diff(M, b: b, n: n, list: list, now: 1)                   // база
    var m = M; m.rhythm[2] = CymStep(on: true, vel: 1, chance: 1, has: false)
    m.melody[4] = CymMark(on: true, x: 0, y: -0.9)
    s.diff(m, b: b, n: n, list: list, now: 2)
    XCTAssertEqual(s.born.r[2], 2); XCTAssertEqual(s.born.m[4], 2); XCTAssertEqual(s.born.r[3], -1e9)
    s.diff(m, b: b, n: n, list: list, now: 3)
    XCTAssertEqual(s.born.r[2], 2); XCTAssertEqual(s.born.m[4], 2)
    m.melody[4].y = -0.85                                       // внутри клетки
    s.diff(m, b: b, n: n, list: list, now: 4)
    XCTAssertEqual(s.born.m[4], 2)
    m.melody[4].x = 0.5; m.melody[4].y = 0                      // другая клетка
    s.diff(m, b: b, n: n, list: list, now: 5)
    XCTAssertEqual(s.born.m[4], 5)
    m.rhythm[2].vel = 0.5                                       // другая сила удара
    s.diff(m, b: b, n: n, list: list, now: 6)
    XCTAssertEqual(s.born.r[2], 6)
    m.rhythm[2].on = false; s.diff(m, b: b, n: n, list: list, now: 7)
    XCTAssertEqual(s.born.r[2], 6)                              // выкл — не рождение
    m.rhythm[2].on = true; s.diff(m, b: b, n: n, list: list, now: 8)
    XCTAssertEqual(s.born.r[2], 8)                              // был выкл — вспышка
    s.rebase(); s.diff(m, b: b, n: n, list: list, now: 9)       // после rebase — только база
    XCTAssertEqual(s.born.r[2], 8); XCTAssertEqual(s.born.m[4], 5)
    // место в молчащей клетке (f0 880, центр) — без вспышки
    var q = CymState(); var c = M; c.melody[1] = CymMark(on: true, x: 0, y: 0)
    q.diff(M, b: 20, n: n, list: list, now: 1); q.diff(c, b: 20, n: n, list: list, now: 2)
    XCTAssertEqual(q.born.m[1], -1e9)
    q.diff(c, b: 5, n: n, list: list, now: 3)                   // щипок: клетки те же — без вспышки
    XCTAssertEqual(q.born.m[1], -1e9)
    // пустой список нот — не падает
    q.diff(c, b: 5, n: n, list: [], now: 4)
  }

  func testHeard() {
    var s = CymState()
    var m = M; m.rhythm[3].on = true; m.melody[1] = CymMark(on: true, x: 0.2, y: -0.3)
    s.heard(.step(r: 3, m: 1, hit: true), mirror: m, list: [], now: 5)
    XCTAssertEqual(s.pulse.r[3], 5); XCTAssertEqual(s.pulse.m[1], 5)
    XCTAssertEqual(s.stars.count, 1); XCTAssertEqual(s.stars[0].x, 0.2); XCTAssertEqual(s.stars[0].y, -0.3)
    XCTAssertEqual(s.lastStep?.r, 3); XCTAssertEqual(s.lastStep?.m, 1); XCTAssertEqual(s.lastStep?.t, 5)
    var t = CymState()
    t.heard(.step(r: 3, m: 1, hit: false), mirror: m, list: [], now: 6)
    XCTAssertEqual(t.pulse.r[3], -1e9); XCTAssertEqual(t.stars.count, 0); XCTAssertEqual(t.lastStep?.t, 6)
    t.heard(.step(r: 0, m: 1, hit: true), mirror: m, list: [], now: 7)   // удар выкл
    XCTAssertEqual(t.pulse.r[0], -1e9); XCTAssertEqual(t.pulse.m[1], -1e9)
    t.heard(.step(r: 40, m: 1, hit: true), mirror: m, list: [], now: 8)  // чужой индекс — только не падать
    t.heard(.answer(semi: 12), mirror: m, list: [], now: 9)
    XCTAssertEqual(t.answerNote, "A2"); XCTAssertEqual(t.answerAt, 9)
  }

  func testStars() {
    var s = CymState()
    for k in 0..<30 { s.starPush(Double(k), 0, 10 + Double(k) * 0.01) }
    XCTAssertEqual(s.stars.count, 24); XCTAssertEqual(s.stars[0].x, 6)
    s.starsAge(now: 10 + 5.1)                                   // старше 5 с — ушли (первые 10 по времени)
    XCTAssertTrue(s.stars.count < 24)
    s.starsAge(now: 100)
    XCTAssertEqual(s.stars.count, 0)
  }

  func testReset() {
    var s = CymState()
    s.own(A.bpm, 0, [120], mirror: M, scale: flat, now: 1)
    s.own(A.setF0, 0, [220], mirror: M, scale: flat, now: 1)
    s.starPush(0.1, 0.1, 1)
    var m = M; m.rhythm[1].on = true
    s.diff(M, b: 5, n: 5, list: flat.noteList(), now: 1)
    s.heard(.step(r: 1, m: 0, hit: true), mirror: m, list: [], now: 1)
    s.reset()
    XCTAssertEqual(s.bpm(mirror: M, now: 1.1), 96); XCTAssertEqual(s.f0(mirror: M, now: 1.1), 110)
    XCTAssertEqual(s.stars.count, 1); XCTAssertEqual(s.pulse.r[1], 1)
    s.diff(m, b: 5, n: 5, list: flat.noteList(), now: 2)        // первый после reset — база
    XCTAssertEqual(s.born.r[1], -1e9)
  }
}
