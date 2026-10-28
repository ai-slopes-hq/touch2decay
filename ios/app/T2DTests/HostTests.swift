import XCTest
@testable import T2D

// поддельное ядро хоста: порядок вызовов, снимки — из очереди
private final class HCore: HostCore {
  var calls: [String] = []                 // restore / scale / vol — в порядке вызова
  var vols: [Double] = [], scales: [Scl] = []
  var snaps: [(slot: Int, id: Int)] = []
  var restores: [(slot: Int, w: String)] = []
  var queue: [(id: Int, slot: Int, w: String)] = []
  func vol(_ gain: Double) -> Bool { vols.append(gain); calls.append("vol"); return true }
  func scale(_ s: Scl) -> Bool { scales.append(s); calls.append("scale"); return true }
  func snap(slot: Int, id: Int) -> Bool { snaps.append((slot, id)); return true }
  func restore(slot: Int, _ w: String) -> Bool { restores.append((slot, w)); calls.append("restore:\(w)"); return true }
  func takeSnap() -> (id: Int, slot: Int, w: String)? { queue.isEmpty ? nil : queue.removeFirst() }
}

// поддельный мир: считает касания и действия; "угол с картой" — прямоугольник x ≥ 300, y ≥ 700
private final class HWorld: World {
  let slot = 10
  let theme = Theme.base
  var title: String { "Fake" }
  var sub: String { "" }
  var legend: [LegendRow] { [] }
  var hasFx: Bool { false }
  var downs = 0, moves = 0, ups = 0, cancels = 0, dices = 0, clears = 0, restoredN = 0
  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {}
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool { x >= 300 && y >= 700 }
  func dice() { dices += 1 }
  func clear() { clears += 1 }
  func restored() { restoredN += 1 }
  func tick(now: Double, dt: Double) {}
  func draw(_ d: Draw, now: Double) {}
  func down(_ f: Finger) { downs += 1 }
  func move(_ f: Finger) { moves += 1 }
  func up(_ f: Finger) { ups += 1 }
  func cancel(_ f: Finger) { cancels += 1 }
  var acted: Bool { downs + moves + ups + cancels + dices + clears > 0 }
}

final class HostTests: XCTestCase {
  private let core = HCore(), world = HWorld()
  private var dir: URL!
  private var store: Store!
  private var host: Host!
  private let bar = TopBar(W: 390, top: 47)
  private var ids: [NSObject] = []

  override func setUp() {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent("host-\(UUID().uuidString)")
    store = Store(dir: dir, log: { _ in })
    host = makeHost()
  }
  override func tearDown() { try? FileManager.default.removeItem(at: dir) }

  private func makeHost() -> Host {
    let h = Host(world: world, core: core, store: store)
    h.layout(W: 390, H: 844, top: 47, safeBot: 34)
    return h
  }
  private func finger(_ n: Int, _ x: CGFloat, _ y: CGFloat, now: Double = 0) -> Finger {
    while ids.count <= n { ids.append(NSObject()) }
    return Finger(id: ObjectIdentifier(ids[n]), x: x, y: y, x0: x, y0: y, t0: now, moved: false, touchTime: now)
  }
  private func tap(_ x: CGFloat, _ y: CGFloat, n: Int = 0) {
    let f = finger(n, x, y); host.down(f); host.up(f)
  }
  // ответ ядра на последний выданный запрос снимка + кадр
  private func answer(_ w: String, now: Double) {
    core.queue.append((core.snaps.last!.id, world.slot, w)); host.tick(now: now, dt: 0.016)
  }

  func testRoutingOrder() {
    tap(50, 60)                                                // заголовок → легенда
    XCTAssertTrue(host.legendOpen)
    tap(195, 400)
    XCTAssertFalse(host.legendOpen); XCTAssertFalse(world.acted, "легенда съела тап")
    tap(bar.pos(.scl).x, bar.pos(.scl).y)
    XCTAssertTrue(host.sclOpen)
    tap(50, 400)
    XCTAssertFalse(host.sclOpen); XCTAssertFalse(world.acted, "тап мимо списка миру не идёт")
    tap(195, 400)
    XCTAssertEqual(world.downs, 1); XCTAssertEqual(world.ups, 1)
  }

  func testDimmedEatsTouch() {
    for p in [bar.pos(.back), bar.pos(.rev)] {
      let f = finger(0, p.x, p.y); host.down(f); host.move(f); host.up(f)
    }
    let f = finger(0, 350, 750); host.down(f); host.move(f); host.up(f)   // «солнце под землёй»
    XCTAssertFalse(world.acted)
  }

  func testVolDrag() {
    let v = bar.pos(.vol), f0 = finger(0, v.x, v.y)
    host.down(f0)
    var f = f0; f.y = v.y - 110; host.move(f)
    XCTAssertEqual(core.vols.last!, Vol.gain(1), accuracy: 1e-12)
    XCTAssertEqual(host.vol, 1, accuracy: 1e-12)
    XCTAssertNil(store.loadPrefs(), "prefs — по подъёму")
    host.up(f)
    XCTAssertEqual(store.loadPrefs()?.vol ?? -1, 1, accuracy: 1e-12)
    // вниз от 1 на 110 pt — на 0.5 ниже
    f = f0; host.down(f); f.y += 110; host.move(f)
    XCTAssertEqual(host.vol, 0.5, accuracy: 1e-12)
    XCTAssertFalse(world.acted)
  }

  func testPrefsVolClamped() {
    store.savePrefs(PrefsFile(vol: 7))
    XCTAssertEqual(makeHost().vol, 1)
    store.savePrefs(PrefsFile(vol: -3))
    XCTAssertEqual(makeHost().vol, 0)
  }

  func testScalePickSendsScale() {
    tap(bar.pos(.scl).x, bar.pos(.scl).y)
    let L = bar.sclList
    tap(L.bx + 20, L.top + TopBar.itemH * 3.5)                 // строка 3: off, major, minor, dorian → idx 2
    XCTAssertEqual(core.scales.last, Scl(on: true, idx: 2, root: 0)); XCTAssertEqual(host.scl, core.scales.last)
    tap(L.rx + L.cw * 0.5 + L.cw, L.top + L.ch * 1.5)          // вторая колонка, ряд 1 → тоника 7
    XCTAssertEqual(core.scales.last, Scl(on: true, idx: 2, root: 7))
    tap(L.bx + 20, L.top + TopBar.itemH * 0.5)                 // off
    XCTAssertEqual(core.scales.last?.on, false)
    XCTAssertFalse(world.acted)
  }

  func testCommitOnAllUp() {
    let a = finger(0, 100, 400), b = finger(1, 200, 400)
    host.down(a); host.down(b)
    host.up(a); XCTAssertEqual(core.snaps.count, 0)
    host.up(b); XCTAssertEqual(core.snaps.count, 1)
    host.down(a); host.cancel(a); XCTAssertEqual(core.snaps.count, 2, "cancel тоже конец жеста")
  }

  func testUndoButton() {
    host.reapply(); answer("w0", now: 1)
    tap(100, 400); answer("w1", now: 2)
    let before = world.restoredN
    tap(bar.pos(.undo).x, bar.pos(.undo).y)
    XCTAssertEqual(core.restores.last?.w, "w0"); XCTAssertEqual(core.restores.last?.slot, 10)
    XCTAssertEqual(world.restoredN, before + 1)
    XCTAssertFalse(world.acted && world.dices + world.clears > 0)
  }

  func testDiceAndClearGoToWorld() {
    tap(bar.pos(.dice).x, bar.pos(.dice).y); tap(bar.pos(.clr).x, bar.pos(.clr).y)
    XCTAssertEqual(world.dices, 1); XCTAssertEqual(world.clears, 1); XCTAssertEqual(world.downs, 0)
  }

  func testReinitReappliesScene() {
    host.reapply(); answer("w0", now: 1)
    tap(100, 400); answer("w1", now: 2)
    tap(bar.pos(.scl).x, bar.pos(.scl).y)
    tap(bar.sclList.bx + 20, bar.sclList.top + TopBar.itemH * 1.5)   // major
    tap(50, 400)                                                     // закрыть список
    core.calls.removeAll()
    host.reapply()
    XCTAssertEqual(core.calls, ["restore:w1", "scale", "vol"])
    XCTAssertEqual(core.vols.last!, Vol.gain(host.vol), accuracy: 1e-12)
  }

  func testLaunchFromFile() {
    let s = Scl(on: true, idx: 3, root: 2)
    store.saveScene(slot: 10, SceneFile(w: "wf", scl: s))
    let h = makeHost()
    h.reapply()
    XCTAssertEqual(core.restores.map(\.w), ["wf"]); XCTAssertEqual(core.scales.last, s); XCTAssertEqual(h.scl, s)
  }

  func testNoFileNoRestore() {
    host.reapply()
    XCTAssertTrue(core.restores.isEmpty)
  }

  func testBackgroundSaves() {
    host.reapply(); answer("w0", now: 1)
    host.background()
    XCTAssertEqual(store.loadScene(slot: 10)?.w, "w0"); XCTAssertNotNil(store.loadPrefs())
    try? FileManager.default.removeItem(at: dir.appendingPathComponent("scene-10.json"))
    host.tick(now: 20, dt: 0.016)
    XCTAssertNil(store.loadScene(slot: 10), "таймер отменён")
  }

  func testAutosaveDebounce() {
    host.reapply(); answer("w0", now: 10)
    host.tick(now: 12.9, dt: 0.016); XCTAssertNil(store.loadScene(slot: 10))
    host.tick(now: 13.1, dt: 0.016); XCTAssertEqual(store.loadScene(slot: 10)?.w, "w0")
  }
}
