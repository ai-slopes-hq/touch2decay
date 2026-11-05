import XCTest
@testable import T2D

// MidiClock: порядок шага и снятие. Политика (кто запускается) — в MidiFollowTests.
private final class ClkWorld: WorldTempo {
  var calls: [String] = []
  var bpm = 120.0, playing = false, armed = true
  func refresh(now: Double) { calls.append("refresh") }
  func setBpm(_ b: Double) { bpm = b; calls.append("set \(b)") }
  func play(_ on: Bool) { playing = on; calls.append("play \(on)") }
  var tempoSet: ((Double) -> Void)?
}

final class MidiClockTests: XCTestCase {
  private let core = FakeCore()

  private var here: ClkWorld?
  private func rig(_ ws: [ClkWorld], here h: ClkWorld?) -> MidiClock {
    here = h
    return MidiClock(core: core, follow: MidiFollow(worlds: { ws }, here: { [unowned self] in self.here }), worlds: { ws })
  }

  func testStepFeedsEventsAndGrid() {
    let a = ClkWorld(), other = ClkWorld(); other.armed = false
    let c = rig([a, other], here: a)
    core.ev = [1, 0, 5, 120, 4, 120]; core.gridV = MidiGrid(t0: 2, p: 0.5)
    c.step(now: 1)
    XCTAssertEqual(a.calls, ["refresh", "play true"])
    XCTAssertTrue(a.playing); XCTAssertFalse(other.playing, "чужой не armed мир не стартует")
    XCTAssertEqual(other.calls.first, "refresh")
  }

  func testStepOnlyRefreshesWithoutGrid() {
    let a = ClkWorld(); let c = rig([a], here: a)
    c.step(now: 1)
    XCTAssertEqual(a.calls, ["refresh"])
  }

  // ядро само перенимает MIDI-темп в мастер: Swift мастер не трогает, миры получают темп политикой
  func testMidiTempoSetsMaster() {
    let a = ClkWorld(); let c = rig([a], here: a)
    core.ev = [3, 133]
    c.step(now: 1)
    XCTAssertEqual(a.bpm, 133); XCTAssertEqual(core.masterBpms, [], "мастер ведёт ядро, не хост")
  }

  func testOffForgetsStopped() {
    let a = ClkWorld(), b = ClkWorld(); b.armed = false
    let c = rig([a, b], here: a)
    c.on = true
    core.ev = [1, 0, 4, 120, 5, 0]; c.step(now: 1)          // a стартует
    core.ev = [2, 0]; c.step(now: 2)                         // Stop остановил a, в «остановленных» — a
    XCTAssertFalse(a.playing)
    a.calls = []; b.calls = []
    c.on = false
    XCTAssertEqual(a.calls, []); XCTAssertEqual(b.calls, [])
    XCTAssertFalse(c.on)
    // набор остановленных забыт: launch запускает только мир на экране, прежде остановленный a — нет
    here = b; b.armed = true
    core.ev = [5, 0]; c.step(now: 3)
    XCTAssertFalse(a.playing, "остановленный до снятия мир не запускается заново")
    XCTAssertTrue(b.playing)
  }

  func testOnDropsStaleEvents() {
    let a = ClkWorld(); let c = rig([a], here: a)
    core.ev = [1, 0, 4, 120, 5, 0]                           // Start + launch накопились, пока часы были выкл.
    c.on = true
    c.step(now: 1)
    XCTAssertFalse(a.playing, "старые события не запускают мир при включении часов")
    c.on = false
  }

  func testTimerStartsAndStops() {
    let a = ClkWorld(); let c = rig([a], here: a)
    c.on = true; XCTAssertTrue(c.on)
    let e = expectation(description: "tick")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { e.fulfill() }
    wait(for: [e], timeout: 2)
    XCTAssertGreaterThan(a.calls.filter { $0 == "refresh" }.count, 2)
    c.on = false
    let n = a.calls.count
    let e2 = expectation(description: "idle")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { e2.fulfill() }
    wait(for: [e2], timeout: 2)
    XCTAssertEqual(a.calls.count, n)
  }
}
