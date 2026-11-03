import XCTest
@testable import T2D

final class PorStateTests: XCTestCase {
  let M = PorMirror()
  typealias A = Por.Act

  func testOwnIsleNoLag() {
    var s = PorState()
    s.own(A.place, 1, [4, 300], mirror: M, now: 1)
    let p = s.isle(1, mirror: M, now: 1.1)
    XCTAssertTrue(p.on); XCTAssertEqual(p.p, 4); XCTAssertEqual(p.sd, 300)
    XCTAssertEqual(p.lvl, 1); XCTAssertEqual(p.oct, 0)
    XCTAssertFalse(s.isle(1, mirror: M, now: 1.26).on)          // 0.25 с вышли — зеркало
    var m2 = M; m2.isles[1] = PorIsle(on: true, p: 4, oct: 0, lvl: 1, sd: 300)
    XCTAssertEqual(s.isle(1, mirror: m2, now: 1.05), m2.isles[1])   // зеркало догнало
    var t = PorState()
    t.own(A.place, 0, [9, 3], mirror: M, now: 1)
    t.own(A.place, 0, [2, 5], mirror: M, now: 1.05)             // на занятое — ничего
    XCTAssertEqual(t.isle(0, mirror: M, now: 1.1).p, 9)
    t.own(A.note, 0, [5], mirror: M, now: 1.1)
    XCTAssertEqual(t.isle(0, mirror: M, now: 1.12).p, 5)
    t.own(A.sink, 0, [], mirror: M, now: 1.2)
    XCTAssertFalse(t.isle(0, mirror: M, now: 1.21).on)
    t.own(A.note, 7, [5], mirror: M, now: 1.2)                  // на пустом — ничего
    XCTAssertFalse(t.isle(7, mirror: M, now: 1.21).on)
  }

  func testOwnMove() {
    var s = PorState()
    s.own(A.place, 0, [3, 1], mirror: M, now: 1)
    s.heard(0, isleOn: true, dt: 0.25, fb: 0.5, now: 1.5)
    s.own(A.move, 0, [1], mirror: M, now: 1.1)
    XCTAssertEqual(s.isle(1, mirror: M, now: 1.2).p, 3)
    XCTAssertFalse(s.isle(0, mirror: M, now: 1.2).on)
    XCTAssertEqual(s.hitT[1], 1.5); XCTAssertEqual(s.hitT[0], -1e9)
    s.own(A.place, 2, [6, 1], mirror: M, now: 1.2)
    s.own(A.move, 1, [2], mirror: M, now: 1.2)                  // на занятое — ничего
    s.own(A.move, 1, [1], mirror: M, now: 1.2)                  // на то же — ничего
    XCTAssertTrue(s.isle(1, mirror: M, now: 1.25).on)
    XCTAssertEqual(s.isle(2, mirror: M, now: 1.25).p, 6)
    s.own(A.isle, 1, [0, 1], mirror: M, now: 1.3)
    s.own(A.isle, 2, [1, 0.5], mirror: M, now: 1.3)
    XCTAssertEqual(s.isle(1, mirror: M, now: 1.31).oct, 1)
    XCTAssertEqual(s.isle(2, mirror: M, now: 1.31).lvl, 0.5)
  }

  func testOwnBuoyEcho() {
    var s = PorState()
    s.own(A.buoy, 0, [0.9, 0.99], mirror: M, now: 1)
    let b = porBuoy(u: 0.9, d: 0.99)
    XCTAssertEqual(s.buoy(mirror: M, now: 1.1).d, 0.95, accuracy: 1e-12)
    XCTAssertEqual(s.buoy(mirror: M, now: 1.1).u, b.u, accuracy: 1e-12)
    XCTAssertEqual(s.echo(0, mirror: M, now: 1.1), b.time)
    s.own(A.echo, 3, [0.5], mirror: M, now: 2)
    let e = s.echo(0, mirror: M, now: 2.1)
    XCTAssertEqual(s.buoy(mirror: M, now: 2.1).d, 0.49, accuracy: 1e-12)
    XCTAssertEqual(s.buoy(mirror: M, now: 2.1).u, porBuoyU(time: e, d: 0.49), accuracy: 1e-12)
    s.own(A.echo, 0, [3], mirror: M, now: 2.2)                  // поверх своего d
    XCTAssertEqual(s.echo(0, mirror: M, now: 2.3), 3)
    XCTAssertEqual(s.buoy(mirror: M, now: 2.3).u, porBuoyU(time: 3, d: 0.49), accuracy: 1e-12)
    XCTAssertEqual(s.buoy(mirror: M, now: 2.6).d, M.buoy.d)     // 0.25 с вышли — пара зеркала
    XCTAssertEqual(s.buoy(mirror: M, now: 2.6).u, M.buoy.u)
  }

  func testOwnScalars() {
    var s = PorState()
    s.own(A.luna, 0, [0.9], mirror: M, now: 1)
    s.own(A.fog, 1, [0.2], mirror: M, now: 1)
    s.own(A.pharos, 0, [4], mirror: M, now: 1)
    s.own(A.bpm, 0, [150], mirror: M, now: 1)
    s.own(A.fx, 2, [0.7], mirror: M, now: 1)
    s.own(A.play, 0, [1], mirror: M, now: 1)
    s.own(A.isle, 0, [1, 0.5], mirror: M, now: 1)               // на пустом — ничего
    XCTAssertEqual(s.luna(0, mirror: M, now: 1.1), 0.9)
    XCTAssertEqual(s.fog(1, mirror: M, now: 1.1), 0.2)
    XCTAssertEqual(s.pharos(0, mirror: M, now: 1.1), 4)
    XCTAssertEqual(s.bpm(mirror: M, now: 1.1), 150)
    XCTAssertEqual(s.fx(2, mirror: M, now: 1.1), 0.7)
    XCTAssertTrue(s.playing(mirror: M, now: 1.1))
    XCTAssertFalse(s.isle(0, mirror: M, now: 1.1).on)
    XCTAssertEqual(s.luna(1, mirror: M, now: 1.1), M.luna[1])
    s.own(A.place, 3, [1, 1], mirror: M, now: 2)
    s.own(A.clear, 0, [], mirror: M, now: 2.05)
    for j in 0..<Por.nstep { XCTAssertFalse(s.isle(j, mirror: M, now: 2.1).on) }
  }

  func testHeard() {
    var s = PorState()
    s.heard(4, isleOn: true, dt: 0.25, fb: 0.5, now: 3)
    XCTAssertEqual(s.hitT[4], 3); XCTAssertEqual(s.lastHit, 4); XCTAssertEqual(s.hits.count, 1)
    s.heard(5, isleOn: false, dt: 0.25, fb: 0.5, now: 4)
    XCTAssertEqual(s.hitT[5], -1e9); XCTAssertEqual(s.hits.count, 1)
    var t = PorState()
    for n in 0..<8 { t.heard(n, isleOn: true, dt: 0.25, fb: 0.5, now: Double(n)) }
    XCTAssertEqual(t.hits.count, 6); XCTAssertEqual(t.hits[0].t, 2)
  }

  func testKill() {
    var s = PorState()
    s.heard(1, isleOn: true, dt: 0.25, fb: 0.5, now: 1)
    s.kill(x: 10, y: 20, now: 5)
    XCTAssertTrue(s.hits.isEmpty); XCTAssertEqual(s.killAt, 5); XCTAssertEqual(s.killXY.x, 10)
  }

  func testAudition() {
    var s = PorState()
    XCTAssertTrue(s.audition(playing: false, now: 0))
    XCTAssertFalse(s.audition(playing: false, now: 0.1))
    XCTAssertTrue(s.audition(playing: false, now: 0.15))
    XCTAssertFalse(s.audition(playing: true, now: 5))
  }

  func testReset() {
    var s = PorState()
    s.own(A.place, 1, [4, 1], mirror: M, now: 1)
    s.own(A.bpm, 0, [150], mirror: M, now: 1)
    s.own(A.buoy, 0, [0.9, 0.99], mirror: M, now: 1)
    s.heard(1, isleOn: true, dt: 0.25, fb: 0.5, now: 1)
    s.kill(x: 1, y: 2, now: 1)
    s.heard(2, isleOn: true, dt: 0.25, fb: 0.5, now: 1)
    s.reset()
    XCTAssertFalse(s.isle(1, mirror: M, now: 1.1).on)
    XCTAssertEqual(s.bpm(mirror: M, now: 1.1), M.bpm)
    XCTAssertEqual(s.buoy(mirror: M, now: 1.1).d, M.buoy.d)
    XCTAssertEqual(s.killAt, -1e9)                              // звезда погасла
    XCTAssertEqual(s.hitT[1], 1); XCTAssertEqual(s.hitT[2], 1)  // удары целы
    XCTAssertEqual(s.hits.count, 1); XCTAssertEqual(s.lastHit, 2)
  }

  func testDiceDropsOwn() {
    var s = PorState()
    s.own(A.place, 1, [4, 1], mirror: M, now: 1)
    s.own(A.fx, 2, [0.7], mirror: M, now: 1)
    s.own(A.kill, 0, [], mirror: M, now: 1.01)                  // KILL, AUDITION — ничего
    s.own(A.audition, 1, [], mirror: M, now: 1.01)
    XCTAssertTrue(s.isle(1, mirror: M, now: 1.02).on)
    s.own(A.dice, 0, [], mirror: M, now: 1.05)
    XCTAssertFalse(s.isle(1, mirror: M, now: 1.1).on)
    XCTAssertEqual(s.fx(2, mirror: M, now: 1.1), M.fx[2])
  }
}
