import XCTest
@testable import T2D

final class TenStateTests: XCTestCase {
  // зеркало из голосов: правим поля прямо
  func mirror(_ f: (inout TenMirror) -> Void = { _ in }) -> TenMirror {
    var m = TenMirror()
    f(&m)
    return m
  }
  func live(_ m: inout TenMirror, _ i: Int, pinned: Bool = false, held: Bool = false, env: Double = 1, envT: Double = 1) {
    m.v[i].active = true; m.v[i].live = true; m.v[i].pinned = pinned; m.v[i].held = held
    m.v[i].env = env; m.v[i].envT = envT
  }

  func testOwnNoLag() {
    var s = TenState()
    var m = mirror { $0.v[2].active = true; $0.v[2].x = 0.1 }
    s.own(Act.move, 2, [0.4, 0.6, 0.1], mirror: m, now: 10)
    XCTAssertEqual(s.voice(2, mirror: m, now: 10).x, 0.4)
    XCTAssertEqual(s.voice(2, mirror: m, now: 10.2).x, 0.4)
    XCTAssertEqual(s.voice(2, mirror: m, now: 10.26).x, 0.1, "ttl вышел — зеркало")
    // сошлось с зеркалом раньше ttl — дальше правка зеркала видна сразу
    m.v[2].x = 0.4; m.v[2].y = 0.6; m.v[2].holeT = 0.1
    s.sync(mirror: m, now: 10.1)
    m.v[2].x = 0.9
    XCTAssertEqual(s.voice(2, mirror: m, now: 10.15).x, 0.9)
  }

  func testOwnSkipsInactive() {
    var s = TenState()
    let m = mirror()
    s.own(Act.move, 1, [0.4, 0.6, 0.1], mirror: m, now: 0)
    s.own(Act.set, 1, [1, 0.3], mirror: m, now: 0)
    XCTAssertEqual(s.voice(1, mirror: m, now: 0), m.v[1])
  }

  func testSpawnResets() {
    var s = TenState()
    let m = mirror {
      for i in [1, 3, 4] { $0.v[i].active = true }
      $0.v[1].mods = [TenMod(src: 3, type: 0, depth: 0.7, auto: true)]
      $0.v[1].lfo[2] = TenLfo(morph: 0, rate: 2, depth: 0.5)
      $0.v[1].cut = 0.2; $0.v[1].amp = 0.4; $0.v[1].pinned = true
      $0.v[4].mods = [TenMod(src: 1, type: 1, depth: 0.5, auto: false), TenMod(src: 3, type: 1, depth: 0.5, auto: false)]
    }
    s.own(Act.spawn, 1, [0.5, 0.5, 0], mirror: m, now: 1)
    let v = s.voice(1, mirror: m, now: 1)
    XCTAssertEqual(v.mods, [])
    XCTAssertTrue(v.lfo.allSatisfy { $0 == nil })
    XCTAssertEqual(v.cut, 0.68); XCTAssertEqual(v.amp, 1); XCTAssertFalse(v.pinned)
    XCTAssertEqual(v.x, 0.5)
    XCTAssertEqual(s.voice(4, mirror: m, now: 1).mods, [TenMod(src: 3, type: 1, depth: 0.5, auto: false)])
  }

  func testPick() {
    var s = TenState()
    var m = mirror()
    XCTAssertEqual(s.pick(mirror: m, now: 0), 0)                                  // пусто — первый свободный
    for i in 0..<3 { live(&m, i, held: true) }
    XCTAssertEqual(s.pick(mirror: m, now: 0), -1)                                 // три временных удерживаются — мест нет
    for i in 0..<3 { m.v[i].held = false }
    XCTAssertEqual(s.pick(mirror: m, now: 0), -1)                                 // отпущены без затухания: envT 1 — не уступают
    m.v[0].held = true; m.v[1].held = true; m.v[2].held = true
    for i in 0..<3 { m.v[i].held = false; m.v[i].envT = 0 }
    m.v[0].env = 0.5; m.v[1].env = 0.3; m.v[2].env = 0.1
    XCTAssertEqual(s.pick(mirror: m, now: 0), 2)                                  // уступает самый тихий затухающий
    m.v[2].held = true
    XCTAssertEqual(s.pick(mirror: m, now: 0), 1)                                  // удерживаемый не выбирается
    m.kept = [1]
    XCTAssertEqual(s.pick(mirror: m, now: 0), 0)                                  // и kept тоже
    m.v[0].held = true
    XCTAssertEqual(s.pick(mirror: m, now: 0), -1)
    // три закреплённых + свободный индекс
    m = mirror()
    for i in 0..<3 { live(&m, i, pinned: true) }
    XCTAssertEqual(s.pick(mirror: m, now: 0), 3)                                  // первый неактивный
    for i in 3..<6 { live(&m, i, held: true) }                                    // плюс три удерживаемых временных
    XCTAssertEqual(s.pick(mirror: m, now: 0), -1)
    m.v[5].held = false; m.v[5].envT = 0
    XCTAssertEqual(s.pick(mirror: m, now: 0), 5)                                  // затухающий уступает, закреплённые — никогда
    // свой SPAWN занимает индекс сразу, и вытеснить его нельзя
    m = mirror()
    s.own(Act.spawn, 0, [0.5, 0.5, 0], mirror: m, now: 0)
    XCTAssertEqual(s.pick(mirror: m, now: 0.01), 1)
  }

  func testPinResult() {
    var s = TenState()
    var m = mirror()
    live(&m, 0); live(&m, 1, pinned: true); live(&m, 2, pinned: true); live(&m, 3)
    XCTAssertEqual(s.pinResult(5, mirror: m, now: 0), .none)                      // неактивный
    XCTAssertEqual(s.pinResult(1, mirror: m, now: 0), .unpinned)
    XCTAssertEqual(s.pinResult(0, mirror: m, now: 0), .pinned)                    // двое закреплённых
    live(&m, 4, pinned: true)
    XCTAssertEqual(s.pinResult(0, mirror: m, now: 0), .full)                      // три закреплённых, четвёртый
    m.v[4].pinned = false
    s.own(Act.pin, 0, [], mirror: m, now: 1)                                      // своё pinned сразу
    XCTAssertTrue(s.voice(0, mirror: m, now: 1).pinned)
    XCTAssertEqual(s.pinResult(0, mirror: m, now: 1), .unpinned)
    XCTAssertEqual(s.pinResult(3, mirror: m, now: 1), .full)
    s.own(Act.pin, 0, [], mirror: m, now: 1.05)
    XCTAssertFalse(s.voice(0, mirror: m, now: 1.05).pinned)
  }

  func testGrabLetGo() {
    var s = TenState()
    let m = mirror { $0.v[0].active = true; $0.v[0].envT = 1 }
    s.own(Act.grab, 0, [], mirror: m, now: 0)
    XCTAssertTrue(s.voice(0, mirror: m, now: 0).held)
    s.own(Act.letGo, 0, [1], mirror: m, now: 0.1)
    XCTAssertFalse(s.voice(0, mirror: m, now: 0.1).held)
    s.own(Act.letGo, 0, [1], mirror: m, now: 0.1)                                  // ниже нуля не уходит
    XCTAssertFalse(s.voice(0, mirror: m, now: 0.1).held)
    XCTAssertFalse(s.anyLive(mirror: m, now: 0.1), "letGo с затуханием гасит envT у временного")
  }

  func testLinkOwn() {
    var s = TenState()
    let m = mirror { $0.v[0].active = true; $0.v[3].active = true }
    s.own(Act.link, 0, [3], mirror: m, now: 0)
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods, [TenMod(src: 3, type: 1, depth: 0.5, auto: false)])
    s.own(Act.linkDepth, 0, [3, 0.8], mirror: m, now: 0)
    s.own(Act.linkType, 0, [3, 2], mirror: m, now: 0)
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods, [TenMod(src: 3, type: 2, depth: 0.8, auto: false)])
    s.own(Act.link, 0, [3], mirror: m, now: 0)                                     // без дубля
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods.count, 1)
    s.own(Act.unlink, 0, [3], mirror: m, now: 0)
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods, [])
    s.own(Act.link, 0, [0], mirror: m, now: 0)                                     // сам на себя — ничего
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods, [])
  }

  func testLinkAutoBecomesManual() {
    var s = TenState()
    let m = mirror { $0.v[0].active = true; $0.v[0].mods = [TenMod(src: 3, type: 0, depth: 0.9, auto: true)] }
    s.own(Act.link, 0, [3], mirror: m, now: 0)
    XCTAssertEqual(s.voice(0, mirror: m, now: 0).mods, [TenMod(src: 3, type: 0, depth: 0.9, auto: false)])
  }

  func testLfoOwn() {
    var s = TenState()
    let m = mirror { $0.v[2].active = true }
    s.own(Act.setLfo, 2, [2, 0, 1.2, 0.35], mirror: m, now: 0)
    XCTAssertEqual(s.voice(2, mirror: m, now: 0).lfo[2], TenLfo(morph: 0, rate: 1.2, depth: 0.35))
    s.own(Act.setLfo, 2, [2, 0, 0, -1], mirror: m, now: 0)
    XCTAssertNil(s.voice(2, mirror: m, now: 0).lfo[2])
  }

  func testRowsOwn() {
    var s = TenState()
    let m = mirror { $0.v[1].active = true; $0.v[1].cut = 0.2 }
    s.own(Act.set, 1, [Double(Row.cut.rawValue), 0.9], mirror: m, now: 0)
    XCTAssertEqual(s.voice(1, mirror: m, now: 0).cut, 0.9)
    XCTAssertEqual(s.voice(1, mirror: m, now: 0.3).cut, 0.2)
  }

  func testAnyLive() {
    var s = TenState()
    var m = mirror()
    XCTAssertFalse(s.anyLive(mirror: m, now: 0))
    live(&m, 2, envT: 0)
    XCTAssertFalse(s.anyLive(mirror: m, now: 0))                                  // затухает
    m.v[2].envT = 1
    XCTAssertTrue(s.anyLive(mirror: m, now: 0))
    m.v[2].active = false
    XCTAssertFalse(s.anyLive(mirror: m, now: 0))
    s.own(Act.spawn, 4, [0.5, 0.5, 0], mirror: m, now: 0)
    XCTAssertTrue(s.anyLive(mirror: m, now: 0.01))                                // свой SPAWN виден сразу
  }

  func testFxOwn() {
    var s = TenState()
    let m = mirror()
    s.own(Act.setFx, 0, [0.5, 2, 0.1, 0.9, 0.4], mirror: m, now: 0)
    XCTAssertEqual(s.fx(mirror: m, now: 0.1), [0.5, 2, 0.1, 0.9, 0.4])
    XCTAssertEqual(s.fx(mirror: m, now: 0.3), m.fx)
  }

  func testKeepOwn() {
    var s = TenState()
    let m = mirror { $0.v[2].active = true; $0.v[2].envT = 1 }
    s.own(Act.keep, 0, [2], mirror: m, now: 0)
    XCTAssertEqual(s.kept(mirror: m, now: 0), [2])
    XCTAssertEqual(s.kept(mirror: m, now: 0.3), [])
    s.own(Act.keep, 0, [2], mirror: m, now: 1)
    s.own(Act.unkeep, 0, [], mirror: m, now: 1.1)
    XCTAssertEqual(s.kept(mirror: m, now: 1.1), [])
    XCTAssertFalse(s.anyLive(mirror: m, now: 1.1), "UNKEEP гасит непривязанного")
  }

  func testReset() {
    var s = TenState()
    let m = mirror { $0.v[2].active = true; $0.v[2].x = 0.1 }
    s.own(Act.move, 2, [0.4, 0.6, 0.1], mirror: m, now: 0)
    s.reset()
    XCTAssertEqual(s.voice(2, mirror: m, now: 0).x, 0.1)
  }
}
