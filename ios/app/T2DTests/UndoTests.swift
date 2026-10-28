import XCTest
@testable import T2D

// поддельное ядро: пишет вызовы, ответы снимков — из очереди
final class FakeCore: HostCore {
  var snaps: [(slot: Int, id: Int)] = []
  var restores: [(slot: Int, w: String)] = []
  var queue: [(id: Int, slot: Int, w: String)] = []
  var full = false
  var snapFull = false
  func vol(_ gain: Double) -> Bool { true }
  func scale(_ s: Scl) -> Bool { true }
  func snap(slot: Int, id: Int) -> Bool { if snapFull { return false }; snaps.append((slot, id)); return true }
  func restore(slot: Int, _ w: String) -> Bool { if full { return false }; restores.append((slot, w)); return true }
  func takeSnap() -> (id: Int, slot: Int, w: String)? { queue.isEmpty ? nil : queue.removeFirst() }
  var lastId: Int { snaps.last!.id }
}

final class UndoTests: XCTestCase {
  let a = Scl(on: true, idx: 1, root: 0), b = Scl(on: true, idx: 2, root: 3)
  var core = FakeCore()
  var u: Undo!
  override func setUp() { core = FakeCore(); u = Undo(core: core) }

  // commit + ответ ядра
  func gesture(_ w: String, _ scl: Scl, slot: Int = 0) {
    u.commit(slot: slot, scl: scl)
    answer(w, slot: slot)
  }
  // ответ ядра на последний выданный запрос (commit или пересборка после undo)
  func answer(_ w: String, slot: Int = 0) {
    core.queue.append((core.lastId, slot, w))
    _ = u.poll()
  }

  func testStepOnlyWhenChanged() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a); XCTAssertEqual(u.depth(slot: 0), 1)
    gesture("w1", a); XCTAssertEqual(u.depth(slot: 0), 1)
  }

  func testLimit10() {
    u.base(slot: 0, w: "w0", scl: a)
    for i in 1...12 { gesture("w\(i)", a) }
    XCTAssertEqual(u.depth(slot: 0), 10)
    _ = u.undo(slot: 0, cur: a)
    XCTAssertEqual(core.restores.last?.w, "w11")
  }

  func testScaleRollback() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", b)                                  // лад a → b в шаге
    let r = u.undo(slot: 0, cur: b)
    XCTAssertTrue(r.done); XCTAssertEqual(r.scl, a)
    answer("w0")                                      // пересборка после undo — база
    gesture("w1", b)
    XCTAssertEqual(u.undo(slot: 0, cur: b).scl, a)
    answer("w0")
    gesture("w1", b)
    let r2 = u.undo(slot: 0, cur: Scl(on: true, idx: 5, root: 1))   // лад трогали после
    XCTAssertTrue(r2.done); XCTAssertNil(r2.scl)
  }

  func testRebaseAfterUndo() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    _ = u.undo(slot: 0, cur: a)
    answer("w0'")                                     // текст после restore другой — не шаг
    XCTAssertEqual(u.depth(slot: 0), 0)
    XCTAssertEqual(u.last(slot: 0)?.w, "w0'")
    gesture("w2", a)
    XCTAssertEqual(u.depth(slot: 0), 1)
  }

  func testFirstGestureAfterUndoIsUndoable() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    _ = u.undo(slot: 0, cur: a)
    answer("w0")
    gesture("w2", a)
    XCTAssertEqual(u.depth(slot: 0), 1)
    _ = u.undo(slot: 0, cur: a)
    XCTAssertEqual(core.restores.last?.w, "w0")
    XCTAssertEqual(u.depth(slot: 0), 0)
  }

  func testRebaseSnapRefusedFallsBack() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    core.snapFull = true
    XCTAssertTrue(u.undo(slot: 0, cur: a).done)       // пересборки нет
    core.snapFull = false
    gesture("w0'", a)                                 // старое правило: база без шага
    XCTAssertEqual(u.depth(slot: 0), 0)
    XCTAssertEqual(u.last(slot: 0)?.w, "w0'")
    gesture("w2", a)
    XCTAssertEqual(u.depth(slot: 0), 1)
  }

  func testBaseDropsEarlierRequests() {
    u.base(slot: 0, w: "w0", scl: a)
    u.commit(slot: 0, scl: a); let old = core.lastId
    u.base(slot: 0, w: "n0", scl: a)                  // переинициализация ядра
    core.queue.append((old, 0, "late"))
    XCTAssertNil(u.poll())
    XCTAssertEqual(u.last(slot: 0)?.w, "n0")
    XCTAssertEqual(u.depth(slot: 0), 0)
  }

  func testStaleResponseAfterUndoIgnored() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    u.commit(slot: 0, scl: a); let stale = core.lastId
    _ = u.undo(slot: 0, cur: a)
    core.queue.append((stale, 0, "w2"))
    XCTAssertNil(u.poll())
    XCTAssertEqual(u.depth(slot: 0), 0)
    XCTAssertEqual(u.last(slot: 0)?.w, "w0")
    answer("w0")                                      // ответ на пересборку принимается
    XCTAssertEqual(u.depth(slot: 0), 0)
  }

  func testUnansweredSnapThenUndo() {
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    u.commit(slot: 0, scl: a); let unanswered = core.lastId   // ответа нет (движок стоит)
    let r = u.undo(slot: 0, cur: a)
    XCTAssertTrue(r.done)
    XCTAssertEqual(core.restores.count, 1); XCTAssertEqual(core.restores[0].w, "w0")
    XCTAssertEqual(u.depth(slot: 0), 0)
    // движок стартовал: ответ на старый запрос отброшен, ответ пересборки — база
    core.queue.append((unanswered, 0, "w1"))
    XCTAssertNil(u.poll())
    answer("w0'")
    XCTAssertEqual(u.depth(slot: 0), 0)
    XCTAssertEqual(u.last(slot: 0)?.w, "w0'")
  }

  func testBaseFromFirstSnap() {
    u.base(slot: 0, w: nil, scl: a)
    gesture("w0", a)
    XCTAssertEqual(u.depth(slot: 0), 0)
    XCTAssertEqual(u.last(slot: 0)?.w, "w0")
    gesture("w1", a)
    XCTAssertEqual(u.depth(slot: 0), 1)
  }

  func testPollReturnsNewBase() {
    u.base(slot: 0, w: "w0", scl: a)
    u.commit(slot: 0, scl: b)
    core.queue.append((core.lastId, 0, "w1"))
    let r = u.poll()
    XCTAssertEqual(r?.slot, 0); XCTAssertEqual(r?.w, "w1"); XCTAssertEqual(r?.scl, b)
    u.commit(slot: 0, scl: b)
    core.queue.append((core.lastId, 0, "w1"))
    XCTAssertNil(u.poll())
  }

  func testUndoEmptyAndRingFull() {
    XCTAssertFalse(u.undo(slot: 0, cur: a).done)
    XCTAssertTrue(core.restores.isEmpty)
    u.base(slot: 0, w: "w0", scl: a)
    gesture("w1", a)
    core.full = true
    XCTAssertFalse(u.undo(slot: 0, cur: a).done)
    XCTAssertEqual(u.depth(slot: 0), 1)
  }

  func testOtherSlotIsolated() {
    u.base(slot: 0, w: "w0", scl: a); u.base(slot: 1, w: "v0", scl: a)
    gesture("w1", a, slot: 0)
    XCTAssertEqual(u.depth(slot: 1), 0)
    u.commit(slot: 1, scl: a)
    core.queue.append((core.lastId, 0, "x"))          // чужой слот при id мира 1
    XCTAssertNil(u.poll())
    XCTAssertEqual(u.depth(slot: 0), 1)
    XCTAssertEqual(u.depth(slot: 1), 0)
    XCTAssertEqual(u.last(slot: 1)?.w, "v0")
  }
}
