import XCTest
@testable import T2D

// поддельное ядро хоста: порядок вызовов, снимки — из очереди
// таблица ладов веба (host/scale.js) — общая для фейков ядра
func webScaleSteps(_ idx: Int) -> [Int] {
  let t = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10]]
  return t.indices.contains(idx) ? t[idx] : []
}

private final class HCore: HostCore {
  var calls: [String] = []                 // restore / scale / vol — в порядке вызова
  var vols: [Double] = [], scales: [Scl] = []
  var snaps: [(slot: Int, id: Int)] = []
  var restores: [(slot: Int, w: String)] = []
  var queue: [(id: Int, slot: Int, w: String)] = []
  func vol(_ gain: Double) -> Bool { vols.append(gain); calls.append("vol"); return true }
  var faders: [(Int, Double)] = [], masters: [[Double]] = []
  func fader(slot: Int, g: Double) -> Bool { faders.append((slot, g)); return true }
  func master(lpf: Double, thr: Double, ratio: Double, ceil: Double) -> Bool { masters.append([lpf, thr, ratio, ceil]); return true }
  func scale(_ s: Scl) -> Bool { scales.append(s); calls.append("scale"); return true }
  func scaleSteps(_ idx: Int) -> [Int] { webScaleSteps(idx) }
  func snap(slot: Int, id: Int) -> Bool { snaps.append((slot, id)); return true }
  func restore(slot: Int, _ w: String) -> Bool { restores.append((slot, w)); calls.append("restore:\(w)"); return true }
  func takeSnap() -> (id: Int, slot: Int, w: String)? { queue.isEmpty ? nil : queue.removeFirst() }
  var lfoSnaps: [LfoSnap] = []
  var addOk = true                         // false — кольцо полно, lfoAdd отброшен
  var specs: [(morph: Double, rate: Double, depth: Double)] = []
  func lfoAdd(slot: Int, obj: Int, key: Int, base: Double, shape: Int) -> Bool { calls.append("lfoAdd:\(obj):\(key):\(base)"); return addOk }
  func lfoSpec(slot: Int, obj: Int, key: Int, morph: Double, rate: Double, depth: Double) -> Bool {
    calls.append("lfoSpec:\(obj):\(key)"); specs.append((morph, rate, depth)); return true
  }
  func lfoBase(slot: Int, obj: Int, key: Int, base: Double) -> Bool { calls.append("lfoBase:\(obj):\(key):\(base)"); return true }
  func lfoOff(slot: Int, obj: Int, key: Int) -> Bool { calls.append("lfoOff:\(obj):\(key)"); return true }
  func lfoDrop(slot: Int, obj: Int) -> Bool { calls.append("lfoDrop:\(slot):\(obj)"); return true }
  func lfoSnap() -> [LfoSnap] { lfoSnaps }
  var levelReads = 0
  func levels(_ out: inout [Float]) -> Bool { levelReads += 1; for i in out.indices { out[i] = 0 }; return true }
  func lfoSample(shape: Int, morph: Double, u: Double, seed: Int) -> Double { sin(2 * .pi * u) }
}

// поддельный мир: считает касания и действия; "угол с картой" — прямоугольник x ≥ 300, y ≥ 700
private final class HWorld: World {
  let slot: Int
  init(_ slot: Int = 10) { self.slot = slot }
  let theme = Theme.base
  var title: String { "Fake" }
  var sub: String { "" }
  var legend: [LegendRow] { [] }
  var fx: SheetSpec?
  var openSheet: ((SheetSpec) -> Void)?
  var objGone: ((Int) -> Void)?
  var sets: [(String, Double)] = []
  var downs = 0, moves = 0, ups = 0, cancels = 0, dices = 0, clears = 0, restoredN = 0
  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat) {}
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool { x >= 300 && y >= 700 }
  func dice() { dices += 1 }
  func clear() { clears += 1 }
  func restored() { restoredN += 1 }
  var enters = 0, scales: [(pcs: [Int]?, root: Int)] = []
  func enter() { enters += 1 }
  func scale(pcs: [Int]?, root: Int) { scales.append((pcs, root)) }
  var ticks = 0, idles = 0
  func tick(now: Double, dt: Double) { ticks += 1 }
  func idle() { idles += 1 }
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

  override class func setUp() {   // шрифты бандла тестов (как в DrawTests): draw хоста рисует плашку
    let urls = Bundle(for: HostTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }
  override func setUp() {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent("host-\(UUID().uuidString)")
    store = Store(dir: dir, log: { _ in })
    host = makeHost(inWorld: true)
  }
  override func tearDown() { try? FileManager.default.removeItem(at: dir) }

  private func makeHost(inWorld: Bool = false, views: [World]? = nil) -> Host {
    let h = Host(views: views ?? [world], core: core, store: store)
    h.layout(W: 390, H: 844, top: 47, safeBot: 34)
    if inWorld { h.go(10) }
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
    let p = bar.pos(.rev)
    let f = finger(0, p.x, p.y); host.down(f); host.move(f); host.up(f)   // у мира нет веера: кнопка тусклая, тап съеден
    XCTAssertFalse(world.acted)
    let e = finger(0, 5, 300); host.down(e); host.move(e); host.up(e)    // левая полоса x < 14 под верхней строкой
    XCTAssertFalse(world.acted, "левый край съедается, как headHit в вебе")
    let e2 = finger(0, 20, 300); host.down(e2); host.up(e2)
    XCTAssertTrue(world.acted, "x ≥ 14 — уже мир")
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
    let live = host.scl
    XCTAssertTrue(live.on, "лад выбран после последнего ответа снимка")
    core.calls.removeAll()
    host.reapply()
    XCTAssertEqual(core.calls, ["restore:w1", "scale", "vol"])
    XCTAssertEqual(core.scales.last, live, "reinit не откатывает лад к последнему снимку")
    XCTAssertEqual(core.vols.last!, Vol.gain(host.vol), accuracy: 1e-12)
  }

  func testLaunchFromFile() {
    let s = Scl(on: true, idx: 3, root: 2)
    store.saveScene(slot: 10, SceneFile(w: "wf", scl: s))
    store.savePrefs(PrefsFile(vol: 0.5, scl: s))             // лад общий — из prefs, не из сцены
    let h = makeHost()
    h.reapply()
    XCTAssertEqual(core.restores.map(\.w), ["wf"]); XCTAssertEqual(core.scales.last, s); XCTAssertEqual(h.scl, s)
  }

  // ---------- вход в мир и лад ----------
  private let major3 = Scl(on: true, idx: 0, root: 3)
  private func link(_ scale: Bool) { store.savePrefs(PrefsFile(vol: 0.5, link: Link(clock: false, scale: scale))) }

  func testGoWorldCallsEnter() {
    let w = HWorld(10); host = makeHost(views: [w])
    host.goWorld(10); XCTAssertEqual(w.enters, 1)
    let w2 = HWorld(10); host = makeHost(views: [w2])
    host.go(10); XCTAssertEqual(w2.enters, 1)
  }

  func testScalePushedToWorlds() {
    let w = HWorld(10), w2 = HWorld(11); host = makeHost(views: [w, w2])
    XCTAssertEqual(w.scales.count, 1); XCTAssertNil(w.scales[0].pcs); XCTAssertEqual(w.scales[0].root, 0, "init: текущий лад")
    host.shotState(scl: major3)
    for x in [w, w2] { XCTAssertEqual(x.scales.last?.pcs, [3, 5, 7, 8, 10, 0, 2]); XCTAssertEqual(x.scales.last?.root, 3) }
    host.shotState(scl: .off)
    for x in [w, w2] { XCTAssertNil(x.scales.last?.pcs); XCTAssertEqual(x.scales.last?.root, 0) }
  }

  func testLinkedScaleFromPrefs() {
    let minor5 = Scl(on: true, idx: 1, root: 5)
    store.savePrefs(PrefsFile(vol: 0.5, scl: minor5))
    let w11 = HWorld(11)
    store.saveScene(slot: 10, SceneFile(w: "a", scl: Scl(on: true, idx: 2, root: 1)))
    store.saveScene(slot: 11, SceneFile(w: "b", scl: Scl(on: true, idx: 4, root: 9)))
    host = makeHost(views: [world, w11])
    XCTAssertEqual(host.scl, minor5)
    host.reapply()
    XCTAssertEqual(host.scl, minor5); XCTAssertEqual(core.scales.last, minor5)
    host.background()
    XCTAssertEqual(store.loadPrefs()?.scl, minor5)
  }

  private func unlinkedSetup(_ w11: HWorld) {
    link(false)
    store.saveScene(slot: 10, SceneFile(w: "a", scl: Scl(on: true, idx: 2, root: 2)))
    store.saveScene(slot: 11, SceneFile(w: "b", scl: Scl(on: true, idx: 4, root: 7)))
  }

  func testUnlinkedSeedsPerSclFromScenes() {
    let w11 = HWorld(11); unlinkedSetup(w11)
    host = makeHost(views: [world, w11])
    host.reapply()
    XCTAssertEqual(host.scl, .off, "на карте — лад из prefs")
    host.goWorld(11); XCTAssertEqual(host.scl, Scl(on: true, idx: 4, root: 7)); XCTAssertEqual(core.scales.last, host.scl)
    tick(5); host.goMap(); tick(10)
    host.goWorld(10); XCTAssertEqual(host.scl, Scl(on: true, idx: 2, root: 2))
  }

  func testUnlinkedFirstEnterAppliesWorldScale() {
    let w11 = HWorld(11); unlinkedSetup(w11)
    host = makeHost(views: [world, w11])
    host.reapply()
    host.goWorld(10)
    XCTAssertEqual(host.scl, Scl(on: true, idx: 2, root: 2)); XCTAssertEqual(core.scales.last, host.scl)
    XCTAssertEqual(world.scales.last?.root, 2)
  }

  func testUnlinkedStartInWorldUsesItsScale() {
    let w11 = HWorld(11); unlinkedSetup(w11)
    host = makeHost(views: [world, w11]); host.go(11)
    host.reapply()
    XCTAssertEqual(host.scl, Scl(on: true, idx: 4, root: 7))
  }

  func testReinitKeepsLiveScale() {
    let w11 = HWorld(11); unlinkedSetup(w11)
    host = makeHost(views: [world, w11])
    host.reapply(); host.goWorld(10)
    let live = Scl(on: true, idx: 3, root: 4)
    host.shotState(scl: live)
    host.reapply()
    XCTAssertEqual(host.scl, live); XCTAssertEqual(core.scales.last, live)
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

  func testBackgroundDrainsUnpolledAnswer() {
    host.reapply(); answer("w0", now: 1)
    tap(100, 400)                                                      // жест → новый запрос снимка
    core.queue.append((id: core.snaps.last!.id, slot: 10, w: "w9"))   // ответ пришёл, тика не было
    host.background()
    XCTAssertEqual(store.loadScene(slot: 10)?.w, "w9")
  }

  func testAutosaveDebounce() {
    host.reapply(); answer("w0", now: 10)
    host.tick(now: 12.9, dt: 0.016); XCTAssertNil(store.loadScene(slot: 10))
    host.tick(now: 13.1, dt: 0.016); XCTAssertEqual(store.loadScene(slot: 10)?.w, "w0")
  }

  // ---------- карта и выходы ----------
  private let field = MapGeo.field(W: 390, H: 844, top: 47, safeBot: 34)
  private func center(_ c: Int, _ r: Int) -> CGPoint { let p = field.rect(col: c, row: r); return CGPoint(x: p.midX, y: p.midY) }
  private func tapCell(_ c: Int, _ r: Int, n: Int = 0) { let p = center(c, r); tap(p.x, p.y, n: n) }
  private func tick(_ t: Double) { host.tick(now: t, dt: 0.016) }

  func testStartsOnMap() {
    host = makeHost()
    XCTAssertEqual(host.nav.view, .map); XCTAssertNil(host.world)
    tap(195, 20)
    XCTAssertEqual(world.downs, 0)
    XCTAssertEqual(host.theme.bg, Theme.base.bg)
  }

  func testTapCardEntersAfterTransition() {
    host = makeHost(); tick(1)
    tapCell(3, 1)
    XCTAssertTrue(host.nav.busy(1))
    tick(1.3); XCTAssertEqual(host.nav.view, .map)
    tick(1.53); XCTAssertEqual(host.nav.view, .world(10)); XCTAssertNil(host.nav.anim)
    XCTAssertNotNil(host.world)
  }

  func testTapOtherCardPeeks() {
    host = makeHost(); tick(1)
    tapCell(1, 1)
    XCTAssertNotNil(host.nav.peek); XCTAssertEqual(host.nav.view, .map); XCTAssertNil(host.nav.anim)
    tick(2)
    XCTAssertNil(host.nav.peek, "peek 420 мс")
    tapCell(0, 0)
    XCTAssertNotNil(host.nav.peek); XCTAssertEqual(host.nav.view, .map)
  }

  func testTouchDuringTransitionEaten() {
    host = makeHost(); tick(1)
    tapCell(3, 1)
    tick(1.2)
    tapCell(3, 1, n: 1); tap(195, 422, n: 2)
    tick(1.53)
    XCTAssertEqual(world.downs, 0)
    XCTAssertNil(host.nav.anim); XCTAssertEqual(host.nav.view, .world(10), "вход один")
    tick(1.6); tapCell(3, 1)    // уже в мире: тап по этому месту — мир
    XCTAssertEqual(world.downs, 1)
  }

  func testBackOnRelease() {
    let p = bar.pos(.back)
    let f = finger(0, p.x, p.y)
    host.down(f); XCTAssertEqual(host.nav.view, .world(10), "на касании ещё нет")
    host.up(f)
    XCTAssertEqual(host.nav.view, .map); XCTAssertNotNil(host.nav.anim); XCTAssertNil(host.world)
    host = makeHost(inWorld: true)
    let g = finger(0, p.x, p.y); host.down(g)
    var m = g; m.x = 80; m.y = 400; host.move(m); host.up(m)
    XCTAssertEqual(host.nav.view, .world(10))
  }

  func testCornerOnRelease() {
    let f = finger(0, 350, 750)
    host.down(f); XCTAssertEqual(host.nav.view, .world(10))
    host.up(f)
    XCTAssertEqual(host.nav.view, .map); XCTAssertEqual(world.downs, 0)
    host = makeHost(inWorld: true)
    let g = finger(0, 350, 750); host.down(g)
    var m = g; m.x = 100; m.y = 300; host.move(m); host.up(m)
    XCTAssertEqual(host.nav.view, .world(10), "ушёл с угла — остаёмся")
  }

  func testEdgeSwipe() {
    let f = finger(0, 5, 400)
    host.down(f)
    var m = f; m.x = 75; m.y = 410
    host.move(m)
    XCTAssertEqual(host.nav.view, .map, "на движении, не дожидаясь подъёма")
    host.up(m)
    host = makeHost(inWorld: true)
    host.down(f); m.y = 480; host.move(m)
    XCTAssertEqual(host.nav.view, .world(10), "крутой — нет")
    host.up(m)
    host = makeHost(inWorld: true)
    let g = finger(0, 20, 400); host.down(g)
    var n = g; n.x = 90; n.y = 405; host.move(n)
    XCTAssertEqual(host.nav.view, .world(10), "старт x 20 — не край")
    XCTAssertEqual(world.moves, 1)
    host.up(n)
  }

  func testEdgeSwipeWithSheetOpenStays() {
    openFx()
    let f = finger(0, 5, 400)
    host.down(f)
    var m = f; m.x = 75; m.y = 410
    host.move(m); host.up(m)
    XCTAssertEqual(host.nav.view, .world(10), "мир остался")
    XCTAssertNil(host.sheet, "касание вне панели — плашка закрылась: оно её")
    XCTAssertEqual(world.downs, 0, "плашка забрала касание целиком")
  }

  func testGoMapClosesOverlays() {
    openFx()
    host.shotState(scl: Scl(on: true, idx: 1, root: 0), sclOpen: true, legendOpen: true)
    XCTAssertNotNil(host.sheet); XCTAssertTrue(host.legendOpen); XCTAssertTrue(host.sclOpen)
    host.goMap()
    XCTAssertNil(host.sheet); XCTAssertFalse(host.legendOpen); XCTAssertFalse(host.sclOpen)
    XCTAssertNotNil(host.snaps[10])
    XCTAssertEqual(host.snaps[10]?.width, Int((390 * Draw.scale).rounded()))
  }

  func testOverlayFingerEatenAfterGoMap() {
    openFx()
    let f = finger(0, 100, 300); host.down(f)          // палец плашки
    host.goMap()
    host.move(f); host.up(f)
    XCTAssertEqual(world.downs + world.moves + world.ups, 0)
    XCTAssertNil(host.sheet)
  }

  func testWorldFingerSurvivesGoMap() {
    host.reapply(); answer("w0", now: 1)
    let a = finger(0, 100, 400), p = bar.pos(.back), b = finger(1, p.x, p.y)
    let n = core.snaps.count
    host.down(a)
    host.down(b); host.up(b)
    XCTAssertEqual(host.nav.view, .map)
    XCTAssertEqual(core.snaps.count, n, "палец мира ещё лежит: commit рано")
    var m = a; m.x = 120; host.move(m)
    XCTAssertEqual(world.moves, 1, "палец мира ведётся в мир и на карте")
    host.up(a)
    XCTAssertEqual(world.ups, 1)
    XCTAssertEqual(core.snaps.count, n + 1, "undo.commit — только когда легли оба")
    XCTAssertEqual(core.snaps.last?.slot, 10)
  }

  func testReapplyOnMapKeepsMap() {
    store.saveScene(slot: 10, SceneFile(w: "wf", scl: Scl(on: true, idx: 1, root: 2)))
    host = makeHost()
    host.reapply()
    XCTAssertEqual(core.restores.map(\.slot), [10]); XCTAssertEqual(host.nav.view, .map)
    XCTAssertEqual(core.scales.last, .off, "лад общий — из prefs (его нет), не из сцены")
    XCTAssertEqual(core.vols.last!, Vol.gain(host.vol), accuracy: 1e-12)
    // смена частоты: лад хоста новее файла — уходит в ядро заново, из файла не перечитывается
    let live = Scl(on: true, idx: 3, root: 5)
    host.shotState(scl: live)
    let v0 = host.vol
    host.go(10)                                      // громкость — ползунок верхней строки: тянем в мире, возвращаемся на карту
    let vp = bar.pos(.vol), f0 = finger(0, vp.x, vp.y)
    host.down(f0); var f = f0; f.y = vp.y - 110; host.move(f); host.up(f)
    host.goMap()
    let v = host.vol
    XCTAssertNotEqual(v, v0, "громкость хоста сменилась")
    core.scales.removeAll(); core.vols.removeAll()
    host.reapply()
    XCTAssertEqual(core.scales, [live]); XCTAssertEqual(host.scl, live)
    XCTAssertEqual(core.vols.count, 1); XCTAssertEqual(core.vols[0], Vol.gain(v), accuracy: 1e-12)
    XCTAssertEqual(host.vol, v); XCTAssertNotEqual(core.vols[0], Vol.gain(v0), "не из файла / по умолчанию")
    XCTAssertEqual(host.nav.view, .map)
  }

  func testSceneSavedPerSlot() {
    let w11 = HWorld(11)
    store.saveScene(slot: 10, SceneFile(w: "a", scl: Scl.off)); store.saveScene(slot: 11, SceneFile(w: "b", scl: Scl.off))
    host = makeHost(views: [world, w11])
    host.reapply()
    XCTAssertEqual(core.restores.map(\.slot), [10, 11])
    XCTAssertEqual(world.restoredN, 1); XCTAssertEqual(w11.restoredN, 1)
    for r in core.snaps { core.queue.append((r.id, r.slot, "n\(r.slot)")) }
    host.tick(now: 1, dt: 0.016)
    host.background()
    XCTAssertEqual(store.loadScene(slot: 10)?.w, "n10"); XCTAssertEqual(store.loadScene(slot: 11)?.w, "n11")
  }

  func testShotFreezeKeepsTransition() {
    let p = bar.pos(.back); tick(1)
    tap(p.x, p.y); host.shotFreeze(0.5)
    tick(5)
    XCTAssertNotNil(host.nav.anim); XCTAssertEqual(host.nav.k(5), 0.5)
  }

  func testLevelsPolledOnMapOnly() {
    host = makeHost(); tick(1); tick(2)
    XCTAssertEqual(core.levelReads, 2, "на карте — раз в 60 мс и реже")
    tapCell(3, 1); tick(2.1); tick(2.7)          // вход закончился в 2.52
    let n = core.levelReads
    tick(3); tick(4)
    XCTAssertEqual(host.nav.view, .world(10))
    XCTAssertEqual(core.levelReads, n, "в мире уровни не опрашиваем")
  }

  func testWorldIdlesOnMapAndTicksInWorld() {
    host = makeHost(); tick(1); tick(1.1)
    XCTAssertEqual(world.idles, 2, "на карте мир не тикает, но кольца сливает"); XCTAssertEqual(world.ticks, 0)
    tapCell(3, 1); tick(1.2); tick(1.5)                // переход: мир ещё не тикает
    XCTAssertEqual(world.ticks, 0); XCTAssertEqual(world.idles, 4)
    tick(3); tick(3.1)
    XCTAssertEqual(host.nav.view, .world(10))
    XCTAssertEqual(world.ticks, 2); XCTAssertEqual(world.idles, 4, "в мире idle не зовём")
  }

  // ---------- плашка и LFO строк ----------
  private func fxSpec() -> SheetSpec {
    let rows = [SheetRow(key: "a", label: "a", code: 6), SheetRow(key: "b", label: "b", code: 7), SheetRow(key: "c", label: "c", code: 8)]
    return SheetSpec(title: "FX", hint: "", rows: rows, get: { _ in 0.5 }, set: { [world] k, v in world.sets.append((k, v)) },
                     text: { _ in "" }, lfo: SheetLfo(obj: -1, keys: ["a", "b", "c"], shape: 1))
  }
  private func openFx() { world.fx = fxSpec(); tap(bar.pos(.rev).x, bar.pos(.rev).y) }
  private func geo() -> SheetGeo { SheetGeo.make(host.sheet!, W: 390, H: 844, safeBot: 34) }
  private func rowY(_ k: String) -> CGFloat { let g = geo(); return g.rows.first { $0.k == k }!.y + 23 }
  private func tilde(_ k: String) { tap(geo().lfoX, rowY(k)) }
  private func snap(_ key: Int, base: Double = 0.5, depth: Double = 0.5) -> LfoSnap {
    LfoSnap(slot: 10, obj: -1, key: key, base: base, morph: 0.5, rate: 1, depth: depth, u: 0, shape: 1, seed: 1)
  }
  private func setSnaps(_ l: [LfoSnap]) { core.lfoSnaps = l; host.tick(now: 1, dt: 0.016) }
  private func lfoCalls() -> [String] { core.calls.filter { $0.hasPrefix("lfo") } }

  func testFxOpensAndClosesSheet() {
    world.fx = nil
    tap(bar.pos(.rev).x, bar.pos(.rev).y)
    XCTAssertNil(host.sheet, "у мира без веера плашки нет")
    openFx(); XCTAssertNotNil(host.sheet)
    tap(bar.pos(.rev).x, bar.pos(.rev).y); XCTAssertNil(host.sheet)
    openFx(); tap(195, geo().top - 20); XCTAssertNil(host.sheet)
  }

  func testSheetEatsTouches() {
    openFx()
    tap(100, rowY("a")); tap(geo().lfoX, rowY("b"))
    XCTAssertNotNil(host.sheet)
    tilde("a")
    let g = geo()
    tap(100, g.panel.pad.y + 20); tap(100, g.panel.shape.y + 5)
    tap(195, g.top - 20)
    XCTAssertEqual(world.downs, 0)
  }

  func testTildeAddsAndCollapses() {
    openFx()
    tilde("b")
    XCTAssertEqual(lfoCalls(), ["lfoAdd:-1:7:0.5"]); XCTAssertEqual(host.sheet?.lfoKey, "b")
    tilde("b")
    XCTAssertNil(host.sheet?.lfoKey); XCTAssertEqual(lfoCalls(), ["lfoAdd:-1:7:0.5"], "свернуть — LFO остаётся")
  }

  func testOffRemoves() {
    openFx(); setSnaps([snap(7)])
    tilde("b"); XCTAssertEqual(lfoCalls(), [], "LFO уже стоит — «~» только открывает панель")
    let o = geo().off
    tap(o.midX, o.midY)
    XCTAssertEqual(lfoCalls(), ["lfoOff:-1:7"])
  }

  func testPadAfterOffReadds() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    let o = geo().off
    tap(o.midX, o.midY); setSnaps([]); core.calls.removeAll()
    let g = geo(), f = finger(0, 200, g.panel.pad.y + 40)
    host.down(f)
    XCTAssertEqual(lfoCalls(), ["lfoAdd:-1:7:0.5", "lfoSpec:-1:7"])
    XCTAssertTrue(core.specs[0].morph.isNaN); XCTAssertFalse(core.specs[0].rate.isNaN); XCTAssertFalse(core.specs[0].depth.isNaN)
    host.up(f)
  }

  func testPendingAddKeepsRowAndNoSpam() {
    openFx(); tilde("b")                                 // lfoAdd послан, снимка ещё нет
    let g = geo(), y = rowY("b"), r = finger(0, 100, y)
    host.down(r)
    var m = r; m.x = 100 + 0.25 * (g.tx1 - g.tx0); host.move(m); host.up(m)
    XCTAssertEqual(core.calls.last, "lfoBase:-1:7:0.75", "строка с LFO в пути — база, не прямая запись")
    XCTAssertTrue(world.sets.isEmpty)
    let p = finger(1, 200, g.panel.pad.y + 40)
    host.down(p); var q = p; q.x = 220; host.move(q); q.x = 240; host.move(q); host.up(q)
    XCTAssertEqual(lfoCalls().filter { $0.hasPrefix("lfoAdd") }.count, 1)
  }

  func testPadDepthZeroRemoves() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    let g = geo(), f = finger(0, 200, g.panel.pad.y + 40)
    host.down(f)
    var m = f; m.y = g.panel.bottom; host.move(m); host.up(m)
    XCTAssertEqual(core.calls.last, "lfoOff:-1:7")
    XCTAssertEqual(core.specs.last!.depth, 0, accuracy: 1e-9)
  }

  func testPadDepthKept() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    let g = geo(), f = finger(0, 200, g.panel.pad.y + 40)
    host.down(f); host.up(f)
    XCTAssertNotEqual(core.calls.last, "lfoOff:-1:7")
  }

  func testStripSetsMorph() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    let g = geo()
    tap(g.panel.x + g.panel.w / 2, g.panel.shape.y + 20)
    XCTAssertEqual(core.specs.count, 1)
    XCTAssertEqual(core.specs[0].morph, 0.5, accuracy: 1e-9)
    XCTAssertTrue(core.specs[0].rate.isNaN); XCTAssertTrue(core.specs[0].depth.isNaN)
  }

  func testRowDragWithLfoMovesBase() {
    openFx(); setSnaps([snap(6, base: 0.4)])
    let g = geo(), y = rowY("a"), f = finger(0, 100, y)
    host.down(f)
    var m = f; m.x = 100 + 0.25 * (g.tx1 - g.tx0); host.move(m); host.up(m)
    XCTAssertEqual(core.calls.last, "lfoBase:-1:6:0.65")
    XCTAssertTrue(world.sets.isEmpty)
  }

  func testRowDragWithoutLfoSets() {
    openFx()
    let g = geo(), y = rowY("a"), f = finger(0, 100, y)
    host.down(f)
    var m = f; m.x = 100 + 0.25 * (g.tx1 - g.tx0); host.move(m); host.up(m)
    XCTAssertEqual(world.sets.last?.0, "a"); XCTAssertEqual(world.sets.last?.1 ?? 0, 0.75, accuracy: 1e-9)
    XCTAssertTrue(lfoCalls().isEmpty)
  }

  func testObjGoneDropsAndClosesSheet() {
    var sp = fxSpec(); sp.lfo = SheetLfo(obj: 5, keys: ["a"], shape: 1)
    world.openSheet?(sp)
    XCTAssertNotNil(host.sheet)
    world.objGone?(6); XCTAssertNotNil(host.sheet)
    world.objGone?(5)
    XCTAssertEqual(core.calls.last, "lfoDrop:10:5"); XCTAssertNil(host.sheet)
  }

  // плашка города Oceanus (без LFO): город пропал из зеркала — хост закрывает её по владельцу
  func testCitySheetClosesWhenCityGone() {
    final class NoCore: Core { func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true } }
    var buf: [Double] = []
    func mirror(_ ids: [Int]) -> [Double] {
      var b = [Double](repeating: 0, count: 74) + [Double(ids.count)]
      for id in ids { b += [0, Double(id), 1, 0.5, 1, 0.8, 0, 0, 220, 0] }
      return b
    }
    let ov = OceanusView(core: NoCore(), geo: OceanGeo(W: 390, H: 844, topY: 47, safeBot: 34), readMirror: { b in
      let n = min(buf.count, b.count); b.replaceSubrange(0..<n, with: buf[0..<n]); return n
    })
    let h = makeHost(views: [ov])
    buf = mirror([3]); ov.tick(now: 1, dt: 0.016)
    ov.openSheet?(ov.citySpec(3))
    XCTAssertNotNil(h.sheet)
    buf = mirror([]); ov.tick(now: 2, dt: 0.016)
    XCTAssertNil(h.sheet, "города нет — плашка закрыта")
  }

  func testAddDroppedKeepsPanelWithoutLfo() {
    core.addOk = false
    openFx(); tilde("b")
    XCTAssertEqual(host.sheet?.lfoKey, "b", "панель открыта и без LFO: «drag the pad»")
    host.tick(now: 1, dt: 0.016)
    host.draw(drawCtx(), now: 1)
    tilde("b"); XCTAssertNil(host.sheet?.lfoKey)
  }

  func testSnapshotEmptyAfterReinit() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    host.reapply(); setSnaps([])
    host.draw(drawCtx(), now: 2)
    core.calls.removeAll()
    tilde("b"); tilde("b")                                      // свернуть и открыть снова
    XCTAssertEqual(lfoCalls(), ["lfoAdd:-1:7:0.5"])
  }

  func testSecondFingerDoesNotBreakFirst() {
    openFx(); setSnaps([snap(6, base: 0.4)])
    let g = geo(), a = finger(0, 100, rowY("a"))
    host.down(a)
    tap(g.lfoX, rowY("b"), n: 1)                               // палец B: «~» и подъём
    var m = a; m.x = 100 + 0.25 * (g.tx1 - g.tx0); host.move(m)
    XCTAssertEqual(core.calls.last, "lfoBase:-1:6:0.65", "жест A жив")
    host.up(m)
  }

  func testSecondFingerKeepsPadRemoval() {
    openFx(); setSnaps([snap(7)]); tilde("b")
    let g = geo(), a = finger(0, 200, g.panel.pad.y + 40)
    host.down(a)
    var m = a; m.y = g.panel.bottom; host.move(m)
    tap(g.panel.x + g.panel.w / 2, g.panel.shape.y + 20, n: 1)  // B на полосе форм
    host.up(m)
    XCTAssertEqual(core.calls.last, "lfoOff:-1:7")
  }

  func testFxHeldWhileFingerOnRev() {
    world.fx = fxSpec()
    let p = bar.pos(.rev), f = finger(0, p.x, p.y)
    host.down(f); XCTAssertTrue(host.fxHeld); host.up(f); XCTAssertFalse(host.fxHeld)
  }

  private func drawCtx() -> Draw {
    let g = CGContext(data: nil, width: 780, height: 1688, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
    g.translateBy(x: 0, y: 1688); g.scaleBy(x: 2, y: -2)
    let d = Draw(g: g, W: 390, H: 844); d.setTheme(world.theme); return d
  }

  // ---------- concordia: тап по солнцу, строки, общий лад ----------
  private func mapField() -> Field { MapGeo.field(W: 390, H: 844, top: 47, safeBot: 34) }
  private func box() -> Concordia.Box { Concordia.box(W: 390, H: 844, safeBot: 34, sunY: mapField().sy) }
  private func tapRow(_ k: Concordia.Key) {
    let b = box(), r = b.rows.first { $0.key == k }!
    tap(b.x + b.w / 2, r.y)
  }

  func testSunOpensConcordia() {
    host = makeHost(); tick(1)
    let sy = mapField().sy
    tap(195, sy)
    XCTAssertEqual(host.settings, .concordia)
    tap(5, 5); XCTAssertEqual(host.settings, .off)
    tap(195 + 60, sy)                                        // подпись concordia
    XCTAssertEqual(host.settings, .concordia)
  }

  func testConcordiaOutsideCloses() {
    host = makeHost(); tick(1); tap(195, mapField().sy)
    let b = box()
    tap(b.x - 8, b.y + 100)
    XCTAssertEqual(host.settings, .off)
    XCTAssertNil(host.nav.peek); XCTAssertNil(host.nav.anim)
  }

  func testConcordiaEatsMap() {
    host = makeHost(); tick(1); tap(195, mapField().sy)
    let p = mapField().rect(col: 3, row: 1)                  // клетка Firmamentum
    tap(p.midX, p.midY)
    XCTAssertNil(host.nav.anim, "касание мимо коробки закрыло настройки и входа не начало")
    XCTAssertEqual(host.settings, .off)
    tap(195, mapField().sy)
    let b = box()
    tap(b.x + b.w / 2, b.y + 8)                              // внутри коробки, но не на строке
    XCTAssertEqual(host.settings, .concordia); XCTAssertNil(host.nav.anim); XCTAssertNil(host.nav.peek)
  }

  func testConcordiaToggles() {
    host = makeHost(); tick(1); tap(195, mapField().sy)
    XCTAssertEqual(host.link, Link(clock: false, scale: true))
    tapRow(.clock); tapRow(.scale)
    XCTAssertEqual(host.link, Link(clock: true, scale: false))
    XCTAssertEqual(host.settings, .concordia, "строка не закрывает коробку")
    tick(4.2)                                                // автосохранение через 3 с
    XCTAssertEqual(store.loadPrefs()?.link, Link(clock: true, scale: false))
  }

  func testStableTogglesAudioAndSaves() {
    host = makeHost(); tick(1); tap(195, mapField().sy)
    var got: [Bool] = []; host.onStable = { got.append($0) }
    tapRow(.stable)
    XCTAssertEqual(got, [true]); XCTAssertTrue(host.audioPref.stable)
    XCTAssertEqual(store.loadPrefs()?.audio, AudioPref(stable: true), "переключение сохраняется сразу")
    tapRow(.stable)
    XCTAssertEqual(got, [true, false]); XCTAssertEqual(store.loadPrefs()?.audio, AudioPref(stable: false))
  }

  func testStableFlashesRestart() {
    host = makeHost(); tick(2); tap(195, mapField().sy)
    XCTAssertLessThan(host.restartAt, -1)
    tapRow(.stable)
    XCTAssertEqual(host.restartAt, 2, "stable перезапускает звук — как в вебе вспыхивает «audio restarted»")
  }

  func testMixDecodeClampsToUnit() throws {
    let j = #"{"g":{"10":2,"11":-1},"mute":{},"lpf":5,"thr":-3,"ratio":1.5,"ceil":99}"#
    let m = try JSONDecoder().decode(Mix.self, from: Data(j.utf8))
    XCTAssertEqual(m.g[10], 1); XCTAssertEqual(m.g[11], 0)
    XCTAssertEqual(m.lpf, 1); XCTAssertEqual(m.thr, 0); XCTAssertEqual(m.ratio, 1); XCTAssertEqual(m.ceil, 1)
  }

  func testRestartCallsAudio() {
    host = makeHost(); tick(2); tap(195, mapField().sy)
    XCTAssertLessThan(host.restartAt, -1, "до первого перезапуска вспышки нет")
    var n = 0; host.onRestart = { n += 1 }
    tapRow(.restart)
    XCTAssertEqual(n, 1); XCTAssertEqual(host.restartAt, 2)
    XCTAssertEqual(host.settings, .concordia)
  }

  func testGoWorldResetsSettings() {
    host = makeHost(); tick(1)
    tap(195, mapField().sy); tap(5, 5)                       // открыть и закрыть тапом мимо
    XCTAssertEqual(host.settings, .off)
    tapCell(3, 1); tick(2)
    XCTAssertEqual(host.nav.view, .world(10)); XCTAssertEqual(host.settings, .off)
    host.goMap(); tick(3)
    XCTAssertEqual(host.settings, .off)
    tap(195, mapField().sy)
    XCTAssertEqual(host.settings, .concordia)
    host.goWorld(10)                                         // из кода, при открытой коробке
    XCTAssertEqual(host.settings, .off)
  }

  func testPerSclWhenUnlinked() {
    let w2 = HWorld(2)
    host = makeHost(views: [world, w2]); tick(1)
    tap(195, mapField().sy); tapRow(.scale); tap(5, 5)       // лад не общий
    XCTAssertFalse(host.link.scale)
    host.go(10)
    let a = Scl(on: true, idx: 1, root: 2), b = Scl(on: true, idx: 3, root: 5)
    host.shotState(scl: a)
    host.goMap(); tick(2)
    host.goWorld(2); XCTAssertEqual(host.scl, a, "у мира 2 лада ещё нет — остаётся текущий")
    tick(3); host.shotState(scl: b)
    host.goMap(); tick(4)
    host.goWorld(10)
    XCTAssertEqual(core.scales.last, a); XCTAssertEqual(host.scl, a)
  }

  func testSclSharedWhenLinked() {
    let w2 = HWorld(2)
    host = makeHost(inWorld: true, views: [world, w2]); tick(1)
    let a = Scl(on: true, idx: 1, root: 2), b = Scl(on: true, idx: 3, root: 5)
    host.shotState(scl: a); host.goMap(); tick(2)
    host.goWorld(2); tick(3); host.shotState(scl: b)
    host.goMap(); tick(4); host.goWorld(10)
    XCTAssertEqual(host.scl, b, "лад общий — при входе не меняется")
  }

  func testPrefsLoadAppliesLink() {
    store.savePrefs(PrefsFile(vol: 0.5, mix: nil, link: Link(clock: true, scale: false), audio: AudioPref(stable: true)))
    let h = makeHost()
    XCTAssertEqual(h.link, Link(clock: true, scale: false)); XCTAssertEqual(h.audioPref, AudioPref(stable: true))
  }

  // ---------- микшер: открыт строкой mixer в concordia ----------
  private func mgeo() -> Mixer.Geo { Mixer.geo(W: 390, H: 844, top: 47, safeBot: 34) }
  private func openMixer() { tap(195, mapField().sy); tapRow(.mixer) }
  private func rowY(_ slot: Int) -> CGFloat { mgeo().rows.first { $0.slot == slot }!.y }
  private func masterY(_ m: MixM) -> CGFloat { mgeo().mr.first { $0.m == m }!.y }
  // палец: касание в (x, y), сдвиг на dx; возвращает палец до подъёма
  private func hold(_ n: Int, _ x: CGFloat, _ y: CGFloat, dx: CGFloat = 0) -> Finger {
    var f = finger(n, x, y); host.down(f); f.x += dx; f.moved = true; host.move(f); return f
  }

  func testMixerOpensAndBack() {
    host = makeHost(); tick(1); openMixer()
    XCTAssertEqual(host.settings, .mixer)
    let g = mgeo()
    tap(g.x + 40, g.top + 20)                                // ‹ concordia
    XCTAssertEqual(host.settings, .concordia)
    tapRow(.mixer); XCTAssertEqual(host.settings, .mixer)
    tap(5, 5)                                                // мимо коробки
    XCTAssertEqual(host.settings, .concordia)
  }

  func testMixerFaderDragRelative() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo(), L = g.tx1 - g.tx0
    let f = hold(0, g.tx0 + 10, rowY(10))
    XCTAssertEqual(host.mix.fader(10), Mix.faderDef, accuracy: 1e-12, "ручка не прыгает к пальцу")
    var m = f; m.x += 0.1 * L; host.move(m)
    XCTAssertEqual(host.mix.fader(10), Mix.faderDef + 0.1, accuracy: 1e-9)
    XCTAssertEqual(core.faders.last { $0.0 == 10 }!.1, host.mix.gain(10), accuracy: 1e-12)
    host.up(m)
  }

  func testMixerDoubleTapDefault() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo()
    let f = hold(0, g.tx0 + 10, rowY(10), dx: 30); host.up(f)
    XCTAssertNotNil(host.mix.g[10])
    tick(2); tap(g.tx0 + 10, rowY(10)); tick(2.1); tap(g.tx0 + 10, rowY(10))
    XCTAssertNil(host.mix.g[10])
    let m = hold(0, g.tx0 + 50, masterY(.thr), dx: -30); host.up(m)
    XCTAssertNotEqual(host.mix[.thr], 0.75)
    tick(3); tap(g.tx0 + 10, masterY(.thr)); tick(3.1); tap(g.tx0 + 10, masterY(.thr))
    XCTAssertEqual(host.mix[.thr], 0.75)
  }

  func testMixerDoubleTapTooSlow() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo()
    let f = hold(0, g.tx0 + 10, rowY(10), dx: 30); host.up(f)
    tick(2); tap(g.tx0 + 10, rowY(10)); tick(2.5); tap(g.tx0 + 10, rowY(10))
    XCTAssertNotNil(host.mix.g[10])
  }

  func testMixerMute() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo()
    tap(g.tx1 + 40, rowY(10))
    XCTAssertEqual(host.mix.mute[10], true); XCTAssertEqual(core.faders.last { $0.0 == 10 }!.1, 0)
    tap(g.tx1 + 40, rowY(10))
    XCTAssertEqual(host.mix.mute[10], false); XCTAssertEqual(core.faders.last { $0.0 == 10 }!.1, 1, accuracy: 1e-12)
  }

  func testMixerMasterSends() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo(), L = g.tx1 - g.tx0
    let f = hold(0, g.tx0 + L / 2, masterY(.ceil), dx: -L); host.up(f)
    let m = core.masters.last!
    XCTAssertEqual(m[0], 22000); XCTAssertEqual(m[1], -10, accuracy: 1e-9)
    XCTAssertEqual(m[2], 2.496, accuracy: 1e-9); XCTAssertEqual(m[3], -12, accuracy: 1e-9)
  }

  func testMixerDragOutsideKeepsMixer() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo(), L = g.tx1 - g.tx0
    var f = hold(0, g.tx0 + 10, rowY(10)); f.x = 1000; f.y = 2000; host.move(f); host.up(f)
    XCTAssertEqual(host.settings, .mixer)
    XCTAssertEqual(host.mix.fader(10), 1, accuracy: 1e-12, "зажато в 0…1")
    _ = L
  }

  func testMixerSecondFingerDoesNotMoveFirst() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo(), L = g.tx1 - g.tx0
    let a = hold(0, g.tx0 + 10, rowY(10), dx: 0.1 * L)
    let v = host.mix.fader(10)
    var b = hold(1, g.tx0 + 10, masterY(.lpf)); b.x -= 0.3 * L; host.move(b)
    XCTAssertEqual(host.mix.fader(10), v, accuracy: 1e-12)
    XCTAssertEqual(host.mix[.lpf], 0.7, accuracy: 1e-9)
    host.up(b); host.up(a)
    XCTAssertEqual(host.settings, .mixer)
  }

  func testReapplySendsMix() {
    store.savePrefs(PrefsFile(vol: 0.5, mix: Mix(g: [4: 0.5], mute: [10: true]), link: Link(), audio: AudioPref()))
    host = makeHost(); core.faders = []; core.masters = []
    host.reapply()
    XCTAssertTrue(core.faders.contains { $0.0 == 4 && abs($0.1 - pow(10, (-36 + 21) / 20)) < 1e-9 })
    XCTAssertTrue(core.faders.contains { $0.0 == 10 && $0.1 == 0 })
    XCTAssertEqual(core.faders.count, 12); XCTAssertEqual(core.masters.count, 1)
  }

  func testMixSavedAfterDrag() {
    host = makeHost(); tick(1); openMixer()
    let g = mgeo()
    let f = hold(0, g.tx0 + 10, rowY(10), dx: 20); host.up(f)
    tick(4.2)
    XCTAssertEqual(store.loadPrefs()?.mix?.g[10], host.mix.g[10])
    XCTAssertNotNil(host.mix.g[10])
  }

  func testMixLoadedOnInit() {
    store.savePrefs(PrefsFile(vol: 0.5, mix: Mix(g: [4: 0.5], mute: [10: true], thr: 0.3), link: Link(), audio: AudioPref()))
    let h = makeHost()
    XCTAssertEqual(h.mix.g[4], 0.5); XCTAssertEqual(h.mix.mute[10], true); XCTAssertEqual(h.mix[.thr], 0.3)
  }

  func testMixerDrawsOpen() {
    host = makeHost(); tick(1); openMixer(); tick(2)
    host.draw(drawCtx(), now: 2)
  }

  // ---------- панель audio: тап по громкости ----------
  private func panelGeo() -> AudioPanel.Geo { AudioPanel.geo(bar: bar, W: 390) }
  private func panelRow(_ k: AudioPanel.Key) -> CGPoint {
    let g = panelGeo(); return CGPoint(x: g.x + g.w / 2, y: g.rows.first { $0.key == k }!.y)
  }
  private func tapVol(at t: Double = 0, hold: Double = 0.1, n: Int = 0) {
    let v = bar.pos(.vol), f = finger(n, v.x, v.y, now: t)
    host.down(f)
    var u = f; u.touchTime = t + hold; host.up(u)
  }
  private func openPanel() { tapVol(); XCTAssertTrue(host.audioPanel) }

  func testVolTapOpensPanel() {
    XCTAssertFalse(host.audioPanel)
    tapVol(); XCTAssertTrue(host.audioPanel)
    tapVol(at: 1); XCTAssertFalse(host.audioPanel)
  }

  func testVolDragNoPanel() {
    let v = bar.pos(.vol), f0 = finger(0, v.x, v.y, now: 5)
    host.down(f0)
    var f = f0; f.y += 40; f.moved = true; f.touchTime = 5.1; host.move(f)
    XCTAssertNotEqual(host.vol, Vol.def)
    host.up(f)
    XCTAssertFalse(host.audioPanel)
  }

  func testVolLongNoPanel() {
    tapVol(hold: 0.3)
    XCTAssertFalse(host.audioPanel)
  }

  func testPanelOutsideCloses() {
    openPanel()
    tap(30, 600)
    XCTAssertFalse(host.audioPanel)
    XCTAssertFalse(world.acted, "тап мимо панели миру не идёт")
  }

  func testPanelVolStillWorks() {
    openPanel()
    let v = bar.pos(.vol), f0 = finger(0, v.x, v.y, now: 5)
    host.down(f0)
    var f = f0; f.y -= 40; f.moved = true; f.touchTime = 5.1; host.move(f)
    XCTAssertGreaterThan(host.vol, Vol.def)
    host.up(f)
    XCTAssertTrue(host.audioPanel, "протяжка громкости панель не трогает")
    tapVol(at: 6); XCTAssertFalse(host.audioPanel, "тап по громкости при открытой панели — закрыл")
  }

  func testPanelStopClears() {
    openPanel()
    let n = core.snaps.count
    let p = panelRow(.stop); tap(p.x, p.y)
    XCTAssertEqual(world.clears, 1); XCTAssertEqual(world.downs, 0)
    XCTAssertGreaterThan(core.snaps.count, n, "как корзина: снимок для отмены")
    XCTAssertTrue(host.audioPanel)
  }

  func testPanelRestartAndStable() {
    openPanel()
    var restarts = 0, got: [Bool] = []
    host.onRestart = { restarts += 1 }; host.onStable = { got.append($0) }
    host.tick(now: 3, dt: 0.016)
    var p = panelRow(.restart); tap(p.x, p.y)
    XCTAssertEqual(restarts, 1); XCTAssertEqual(host.restartAt, 3)
    p = panelRow(.stable); tap(p.x, p.y)
    XCTAssertEqual(got, [true]); XCTAssertTrue(host.audioPref.stable)
    XCTAssertEqual(store.loadPrefs()?.audio?.stable, true, "stable — сразу на диск")
  }

  func testPanelTempoInert() {
    openPanel()
    let before = core.calls.count
    let p = panelRow(.tempo), f = finger(0, p.x, p.y)
    host.down(f); var m = f; m.x += 60; m.moved = true; host.move(m); host.up(m)
    XCTAssertFalse(world.acted)
    XCTAssertEqual(core.calls.count, before)
    XCTAssertTrue(host.audioPanel)
    XCTAssertFalse(host.audioPref.stable)
  }

  func testGoMapClosesAudioPanel() {
    openPanel(); host.goMap(); XCTAssertFalse(host.audioPanel)
    host = makeHost(inWorld: true); openPanel()
    let f = finger(0, 5, 400); host.down(f)
    var m = f; m.x = 75; m.y = 410; host.move(m); host.up(m)
    XCTAssertEqual(host.nav.view, .map); XCTAssertFalse(host.audioPanel)
  }

  func testPanelPollsLevelsInWorld() {
    host.tick(now: 1, dt: 0.016); let n = core.levelReads
    openPanel(); host.tick(now: 2, dt: 0.016)
    XCTAssertGreaterThan(core.levelReads, n)
  }

  func testPanelDrawsOpen() {
    openPanel(); host.tick(now: 1, dt: 0.016); host.draw(drawCtx(), now: 1)
  }
}
