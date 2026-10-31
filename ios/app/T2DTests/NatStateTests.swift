import XCTest
@testable import T2D

final class NatStateTests: XCTestCase {
  let acc = 1e-9
  let M = NatMirror()
  func geo() -> NatGeo { NatGeo(W: 390, H: 844, topY: 50, safeBot: 34) }

  func testOwnPadNoLag() {
    var s = NatState()
    s.own(Nat.Act.plant, 1, [4, 2], mirror: M, now: 1)
    var p = s.pad(1, mirror: M, now: 1.1)
    XCTAssertTrue(p.on); XCTAssertEqual(p.note, 4); XCTAssertEqual(p.wave, 2)
    XCTAssertFalse(s.pad(1, mirror: M, now: 1.26).on)          // 0.25 с вышли — зеркало
    // зеркало догнало
    var m2 = M; m2.pads[1] = NatPad(on: true, note: 4, wave: 2)
    XCTAssertEqual(s.pad(1, mirror: m2, now: 1.05), m2.pads[1])
    // смена зеркала после схождения — новое
    var m3 = M; m3.pads[1] = NatPad(on: true, note: 9, wave: 1)
    p = s.pad(1, mirror: m3, now: 1.1)
    XCTAssertEqual(p.note, 9)
    // PLANT на занятое — ничего
    var t = NatState()
    t.own(Nat.Act.plant, 0, [9, 3], mirror: M, now: 1)
    XCTAssertEqual(t.pad(0, mirror: M, now: 1.1).note, 2)
  }

  func testOwnMove() {
    var s = NatState()
    s.own(Nat.Act.move, 0, [1], mirror: M, now: 1)
    XCTAssertEqual(s.pad(1, mirror: M, now: 1.1).note, 2)
    XCTAssertFalse(s.pad(0, mirror: M, now: 1.1).on)
    var t = NatState()
    t.own(Nat.Act.move, 0, [2], mirror: M, now: 1)               // занято
    XCTAssertTrue(t.pad(0, mirror: M, now: 1.1).on); XCTAssertEqual(t.pad(2, mirror: M, now: 1.1).note, 7)
    t.own(Nat.Act.move, 0, [0], mirror: M, now: 1)               // то же место
    XCTAssertTrue(t.pad(0, mirror: M, now: 1.1).on)
    t.own(Nat.Act.move, 1, [4], mirror: M, now: 1)               // из пустого
    XCTAssertFalse(t.pad(4, mirror: M, now: 1.1).on)
  }

  func testOwnLockChance() {
    var s = NatState()
    s.own(Nat.Act.plock, 3, [1, 0.7], mirror: M, now: 1)
    XCTAssertEqual(s.pad(3, mirror: M, now: 1.1).lock[1], 0.7, accuracy: acc)
    s.own(Nat.Act.punlock, 3, [1], mirror: M, now: 1)
    XCTAssertEqual(s.pad(3, mirror: M, now: 1.1).lock[1], -1, accuracy: acc)
    s.own(Nat.Act.pchance, 3, [0.6], mirror: M, now: 1)
    XCTAssertEqual(s.pad(3, mirror: M, now: 1.1).chanceV, 0.6, accuracy: acc)
    s.own(Nat.Act.punlock, 3, [4], mirror: M, now: 1)
    let p = s.pad(3, mirror: M, now: 1.1)
    XCTAssertEqual(p.chance, -1, accuracy: acc); XCTAssertEqual(p.chanceV, 1, accuracy: acc)
    s.own(Nat.Act.pwave, 3, [4], mirror: M, now: 1)
    XCTAssertEqual(s.lastWave, 4); XCTAssertEqual(s.pad(3, mirror: M, now: 1.1).wave, 4)
    s.own(Nat.Act.pglide, 3, [1], mirror: M, now: 1)
    XCTAssertTrue(s.pad(3, mirror: M, now: 1.1).glide)
    s.own(Nat.Act.note, 3, [9], mirror: M, now: 1)
    XCTAssertEqual(s.pad(3, mirror: M, now: 1.1).note, 9)
    s.own(Nat.Act.wave, 0, [2], mirror: M, now: 1)
    XCTAssertEqual(s.lastWave, 2)
    // пустое место: правки ничего
    var t = NatState()
    t.own(Nat.Act.note, 1, [9], mirror: M, now: 1)
    t.own(Nat.Act.plock, 1, [0, 0.5], mirror: M, now: 1)
    XCTAssertEqual(t.pad(1, mirror: M, now: 1.1), M.pads[1])
  }

  func testOwnScalars() {
    var s = NatState()
    s.own(Nat.Act.len, 0, [5], mirror: M, now: 1)
    s.own(Nat.Act.setbpm, 0, [140], mirror: M, now: 1)
    s.own(Nat.Act.play, 0, [1], mirror: M, now: 1)
    s.own(Nat.Act.setfx, 4, [0.9], mirror: M, now: 1)
    XCTAssertEqual(s.len(mirror: M, now: 1.1), 5)
    XCTAssertEqual(s.bpm(mirror: M, now: 1.1), 140, accuracy: acc)
    XCTAssertTrue(s.playing(mirror: M, now: 1.1))
    XCTAssertEqual(s.fx(4, mirror: M, now: 1.1), 0.9, accuracy: acc)
    XCTAssertEqual(s.fx(3, mirror: M, now: 1.1), 0.4, accuracy: acc)
    XCTAssertEqual(s.len(mirror: M, now: 1.3), 12)
    XCTAssertEqual(s.fx(4, mirror: M, now: 1.3), 0.62, accuracy: acc)
    s.own(Nat.Act.clear, 0, [], mirror: M, now: 2)
    for i in 0..<16 { XCTAssertFalse(s.pad(i, mirror: M, now: 2.1).on) }
    XCTAssertTrue(s.pad(0, mirror: M, now: 2.3).on)
  }

  func testShake() {
    var s = NatState()
    s.own(Nat.Act.shakeby, 0, [0.5], mirror: M, now: 1)
    XCTAssertEqual(s.shake(mirror: M, now: 1), 0.5, accuracy: acc)
    XCTAssertEqual(s.shake(mirror: M, now: 1.2), 0.5 * exp(-0.2 / 1.4), accuracy: acc)
    XCTAssertEqual(s.shake(mirror: M, now: 1.3), 0, accuracy: acc)
    var t = NatState()
    t.own(Nat.Act.shakeby, 0, [0.7], mirror: M, now: 1)
    t.own(Nat.Act.shakeby, 0, [0.7], mirror: M, now: 1)
    XCTAssertEqual(t.shake(mirror: M, now: 1), 1, accuracy: acc)
  }

  func testPhase() {
    var m = M; m.phase = 3.2; m.playing = true; m.bpm = 96
    var s = NatState()
    XCTAssertEqual(s.phase(mirror: m, mAt: 1, now: 1.05)!, 3.2 + 0.05 / 0.15625, accuracy: acc)
    XCTAssertEqual(s.phase(mirror: m, mAt: 1, now: 2)!, 4.2, accuracy: acc)
    s.own(Nat.Act.play, 0, [0], mirror: m, now: 2)
    XCTAssertNil(s.phase(mirror: m, mAt: 1, now: 2.1))
    var m2 = m; m2.phase = -1
    XCTAssertNil(NatState().phase(mirror: m2, mAt: 1, now: 1.05))
  }

  func testScareEnv() {
    var s = NatState()
    XCTAssertFalse(s.envOpen(now: 0))
    s.own(Nat.Act.scare, 0, [], mirror: M, now: 2)
    XCTAssertTrue(s.envOpen(now: 5.9)); XCTAssertFalse(s.envOpen(now: 6.1))
    s.own(Nat.Act.laser, 0, [], mirror: M, now: 7)
    XCTAssertEqual(s.birdsAt, 7, accuracy: acc)
  }

  func testHeard() {
    var s = NatState()
    s.heard(2, 4, now: 3); s.heard(1, 0, now: 3)
    XCTAssertEqual(s.noteAt[4], 3); XCTAssertEqual(s.playedAt[0], 3)
    XCTAssertEqual(s.noteAt[0], -1e9); XCTAssertEqual(s.playedAt[4], -1e9)
    s.heard(7, 1, now: 3); s.heard(1, 99, now: 3)   // не падает
    XCTAssertEqual(s.noteAt[1], -1e9)
  }

  func testFrog() {
    let g = geo()
    var s = NatState()
    let pads = M.pads
    var calls = 0
    let r: () -> Double = { calls += 1; return 0.1 }
    var f = s.frog(geo: g, pads: pads, len: 12, now: 10, R: r)!
    XCTAssertEqual(f.i, 0); XCTAssertFalse(f.air); XCTAssertEqual(s.frogI, 0)
    let p = g.padXY(0, 2)
    XCTAssertEqual(f.x, p.x + 4 * p.s, accuracy: acc); XCTAssertEqual(f.y, p.y - 3 * p.s, accuracy: acc)
    XCTAssertEqual(f.s, 0.7 + 0.5 * p.s, accuracy: acc)
    XCTAssertEqual(calls, 0)
    // её кувшинка заиграла после 8 с — прыжок
    s.heard(1, 0, now: 19)
    f = s.frog(geo: g, pads: pads, len: 12, now: 19, R: r)!
    XCTAssertTrue(f.air); XCTAssertNotEqual(s.frogI, 0); XCTAssertEqual(f.i, s.frogI); XCTAssertEqual(calls, 1)
    XCTAssertEqual(s.frogI, 2)                          // самая молчаливая, наименьший индекс
    f = s.frog(geo: g, pads: pads, len: 12, now: 19.35, R: r)!
    XCTAssertTrue(f.air)
    f = s.frog(geo: g, pads: pads, len: 12, now: 19.8, R: r)!
    XCTAssertFalse(f.air)
    // сразу после посадки — не прыгает
    s.heard(1, 2, now: 19.9)
    f = s.frog(geo: g, pads: pads, len: 12, now: 19.9, R: r)!
    XCTAssertFalse(f.air); XCTAssertEqual(s.frogI, 2)
    // R ≥ 0.35 — остаётся
    var t = NatState()
    _ = t.frog(geo: g, pads: pads, len: 12, now: 10, R: r)
    t.heard(1, 0, now: 30)
    f = t.frog(geo: g, pads: pads, len: 12, now: 30, R: { 0.9 })!
    XCTAssertFalse(f.air); XCTAssertEqual(t.frogI, 0)
    // кувшинка убрана — новое место без прыжка
    var pads2 = pads; pads2[0] = NatPad()
    f = t.frog(geo: g, pads: pads2, len: 12, now: 31, R: r)!
    XCTAssertFalse(f.air); XCTAssertEqual(f.i, 2)
    // без кувшинок — nil
    var empty = pads; for i in 0..<16 { empty[i] = NatPad() }
    XCTAssertNil(t.frog(geo: g, pads: empty, len: 12, now: 32, R: r))
    // за пределами len — не считаются
    var u = NatState()
    XCTAssertEqual(u.frog(geo: g, pads: pads, len: 1, now: 1, R: r)!.i, 0)
    XCTAssertNil(u.frog(geo: g, pads: pads, len: 0, now: 2, R: r))
  }

  func testReset() {
    var s = NatState()
    s.own(Nat.Act.plant, 1, [4, 2], mirror: M, now: 1)
    s.own(Nat.Act.len, 0, [5], mirror: M, now: 1)
    s.own(Nat.Act.shakeby, 0, [0.5], mirror: M, now: 1)
    s.own(Nat.Act.pwave, 0, [3], mirror: M, now: 1)
    s.own(Nat.Act.scare, 0, [], mirror: M, now: 1)
    s.reset()
    XCTAssertEqual(s.pad(1, mirror: M, now: 1.1), M.pads[1])
    XCTAssertEqual(s.pad(0, mirror: M, now: 1.1), M.pads[0])
    XCTAssertEqual(s.len(mirror: M, now: 1.1), 12)
    XCTAssertEqual(s.shake(mirror: M, now: 1.1), 0, accuracy: acc)
    XCTAssertEqual(s.lastWave, 3); XCTAssertEqual(s.goneAt, 1)
  }
}
