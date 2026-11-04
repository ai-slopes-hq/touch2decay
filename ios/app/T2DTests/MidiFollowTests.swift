import XCTest
@testable import T2D

// Зеркало политики из tools/test-midi.mjs: события ядра (пары код, bpm) подаём как есть.
private final class FakeTempo: WorldTempo {
  var calls: [String] = []
  var bpm: Double
  var playing: Bool
  var armed: Bool
  init(bpm: Double = 120, playing: Bool = false, armed: Bool = false) { self.bpm = bpm; self.playing = playing; self.armed = armed }
  func refresh(now: Double) {}
  func setBpm(_ b: Double) { bpm = b; calls.append("set \(b)") }
  func play(_ on: Bool) { playing = on; calls.append("play \(on)") }
  var plays: [String] { calls.filter { $0.hasPrefix("play") } }
}

final class MidiFollowTests: XCTestCase {
  private let START = 1.0, STOP = 2.0, TEMPO = 3.0, BEAT = 4.0, LAUNCH = 5.0
  private var here: WorldTempo?

  private func rig(_ ws: [FakeTempo], here h: FakeTempo? = nil) -> MidiFollow {
    here = h
    return MidiFollow(worlds: { ws }, here: { [unowned self] in self.here })
  }
  /// первый бит после старта: темп, затем запуск
  private func beat(_ m: MidiFollow, _ bpm: Double = 120, launch: Bool = true) {
    m.events([BEAT, bpm] + (launch ? [LAUNCH, 0] : []))
  }

  func testStartWaitsForFirstBeat() {
    let a = FakeTempo(armed: true)
    let m = rig([a], here: a)
    m.events([START, 0])
    XCTAssertEqual(a.calls, [])
    beat(m)
    XCTAssertEqual(a.plays, ["play true"])
  }

  func testStartRunsHandStartedOnScreenAndStoppedByMidi() {
    let nat = FakeTempo(armed: true), cym = FakeTempo(armed: true), por = FakeTempo(armed: true)
    let mono = FakeTempo(armed: false), horo = FakeTempo(armed: true)
    let m = rig([nat, cym, por, mono, horo], here: por)
    cym.playing = true; m.scan(); cym.playing = false; m.scan()   // Cymatica запускали руками и остановили
    mono.playing = true; m.scan()                                  // автострам играет
    m.events([STOP, 0])
    XCTAssertFalse(mono.playing)
    m.events([START, 0]); beat(m)
    XCTAssertTrue(cym.playing)       // свой
    XCTAssertTrue(por.playing)       // на экране
    XCTAssertTrue(mono.playing)      // остановлен Stop
    XCTAssertFalse(nat.playing)      // не трогали
    XCTAssertFalse(horo.playing)
  }

  func testWorldStartedByHandBeforeFirstBeatJoins() {
    let w = FakeTempo(armed: true)
    let m = rig([w])
    m.events([START, 0])
    w.playing = true                  // скана ещё не было
    beat(m)
    XCTAssertEqual(w.plays, ["play false", "play true"])
  }

  func testServiceStartedWorldIsNotStartedByHand() {
    let w = FakeTempo(armed: true), other = FakeTempo(armed: true)
    let m = rig([w, other], here: w)
    m.events([START, 0]); beat(m); m.scan()
    XCTAssertTrue(w.playing)          // на экране: запустила служба
    w.playing = false; m.scan()       // остановил руками
    here = other                      // ушёл в другой мир
    m.events([START, 0]); beat(m)
    XCTAssertFalse(w.playing)
    XCTAssertTrue(other.playing)
  }

  func testStartRestartsPlayingWorld() {
    let w = FakeTempo(playing: true)
    let m = rig([w])
    m.events([START, 0]); beat(m)
    XCTAssertEqual(w.plays, ["play false", "play true"])
  }

  func testStopStopsEverySequencer() {
    let a = FakeTempo(playing: true), b = FakeTempo(playing: true), c = FakeTempo()
    let m = rig([a, b, c])
    beat(m, launch: false)
    m.events([STOP, 0])
    XCTAssertFalse(a.playing); XCTAssertFalse(b.playing)
    XCTAssertEqual(c.plays, [])
  }

  func testTempoGoesToEveryWorldOverThreeTenths() {
    let a = FakeTempo(), b = FakeTempo()
    let m = rig([a, b])
    m.events([BEAT, 120.2])
    XCTAssertEqual(a.calls, []); XCTAssertEqual(b.calls, [])
    m.events([BEAT, 120.4])
    XCTAssertEqual(a.calls, ["set 120.4"]); XCTAssertEqual(b.calls, ["set 120.4"])
  }

  func testTempoKnobIsOverriddenAtNextBeat() {
    let a = FakeTempo(bpm: 100, playing: true)
    let m = rig([a])
    m.events([BEAT, 120])
    XCTAssertEqual(a.calls, ["set 120.0"])
  }

  func testRepeatedStopKeepsWhoWasPlaying() {
    let a = FakeTempo(playing: true)
    let m = rig([a])
    m.events([STOP, 0, STOP, 0])
    m.events([START, 0]); beat(m)
    XCTAssertTrue(a.playing)
  }

  func testUnknownTempoIsIgnored() {
    let a = FakeTempo(bpm: 100)
    let m = rig([a])
    m.events([TEMPO, 0])
    XCTAssertEqual(a.calls, [])
  }

  func testResetForgetsStopped() {
    let a = FakeTempo(armed: true)
    let m = rig([a], here: a)
    m.events([LAUNCH, 0])             // запустила служба, не руками
    m.events([STOP, 0]); here = nil; m.reset()
    m.events([LAUNCH, 0])
    XCTAssertFalse(a.playing)
  }

  func testBeatsWithoutStartDoNotPlayAfterStop() {
    let scr = FakeTempo(armed: true), was = FakeTempo(playing: true), hand = FakeTempo(armed: true)
    let m = rig([scr, was, hand], here: scr)
    hand.playing = true; m.scan(); hand.playing = false; m.scan()   // запускали руками
    m.events([STOP, 0, STOP, 0, STOP, 0])
    scr.calls = []; was.calls = []; hand.calls = []
    m.events([BEAT, 120, TEMPO, 120, BEAT, 120])                    // часы идут, Start не было
    XCTAssertEqual(scr.plays, []); XCTAssertEqual(was.plays, []); XCTAssertEqual(hand.plays, [])
    XCTAssertFalse(scr.playing); XCTAssertFalse(was.playing); XCTAssertFalse(hand.playing)
  }

  func testLaunchAfterRepeatedStopStartsStoppedAndArmed() {
    let scr = FakeTempo(armed: true), was = FakeTempo(playing: true), idle = FakeTempo(armed: true)
    let m = rig([scr, was, idle], here: scr)
    m.events([STOP, 0, STOP, 0]); m.events([BEAT, 120])
    XCTAssertEqual(scr.plays, []); XCTAssertEqual(was.plays, ["play false"])
    m.events([START, 0, BEAT, 120, LAUNCH, 0])
    XCTAssertTrue(scr.playing); XCTAssertTrue(was.playing); XCTAssertFalse(idle.playing)
  }
}
