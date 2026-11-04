import XCTest
@testable import T2D

private final class TRec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// связка мира: действия со своими значениями, тик (зеркало, heard, солнце, вид голосов, волны), кубик, веер, лад, зум (app.js:513, 830-840, 1857-1936)
final class TenebraeTests: XCTestCase {
  private let rec = TRec()
  private var mbuf: [Double] = []
  private var heardQ: [[Double]] = []
  private var level = 0.0
  private lazy var view = TenebraeView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mbuf.count, b.count); b.replaceSubrange(0..<n, with: self.mbuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, readLevel: { [unowned self] in self.level }, rng: { 0.5 })
  private let bot = 806.0                                  // 844 − 34 − 4

  override func setUp() {
    mbuf = mirror()
    view.layout(W: 390, H: 844, topY: 103, safeBot: 34)
  }

  // зеркало 387: [0] = 6, fx по умолчанию, у всех LFO нет (depth −1)
  private func mirror(_ edit: (inout [Double]) -> Void = { _ in }) -> [Double] {
    var b = [Double](repeating: 0, count: Ten.mirrorN)
    b[0] = 6; b[3] = 0.3; b[4] = 3.5; b[5] = 0.3; b[6] = 0; b[7] = 0.2
    for i in 0..<6 { for k in 0..<8 { b[Ten.head + Ten.voiceN * i + 38 + 3 * k + 2] = -1 } }
    edit(&b)
    return b
  }
  private func set(_ b: inout [Double], _ i: Int, active: Bool = true, pinned: Bool = false, held: Bool = false,
                   x: Double = 0.4, y: Double = 0.5, beat: Double = 0.35, env: Double = 1, envT: Double = 1, holeT: Double = 0) {
    let o = Ten.head + Ten.voiceN * i
    b[o] = active ? 1 : 0; b[o + 1] = active ? 1 : 0; b[o + 2] = pinned ? 1 : 0; b[o + 3] = held ? 1 : 0
    b[o + 4] = x; b[o + 5] = y; b[o + 6] = beat; b[o + 13] = holeT; b[o + 15] = env; b[o + 16] = envT
  }
  private func load(_ edit: @escaping (inout [Double]) -> Void) { mbuf = mirror(edit) }

  func testSendOwns() {
    load { self.set(&$0, 2) }
    view.tick(now: 1, dt: 0.016)
    view.send(Act.move, 2, [0.3, 0.4, 0], touchTime: 1.5)
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 21); XCTAssertEqual(rec.acts[0].i, 2)
    XCTAssertEqual(rec.acts[0].a, [0.3, 0.4, 0]); XCTAssertEqual(rec.acts[0].t, 1.5)
    XCTAssertEqual(view.voice(2).x, 0.3, "своё значение сразу")
    XCTAssertEqual(view.voice(2).y, 0.4)
  }

  func testIdentity() {
    XCTAssertEqual(view.title, "Tenebrae"); XCTAssertEqual(view.sub, "orbes · strepitus")
    XCTAssertEqual(view.slot, 1); XCTAssertEqual(TenebraeView.slotN, 1)
    XCTAssertEqual(view.legend.count, 8)
    XCTAssertEqual(view.legend.map(\.glyph), [.tap, .drag, .double, .hold, .two, .pinch, .drag, .tap])
    XCTAssertEqual(view.legend[0].gesture, "touch the field")
    XCTAssertEqual(view.legend[0].does, "sounds while held · farther from the sun — higher")
    XCTAssertEqual(view.legend[7].gesture, "tap the sun"); XCTAssertEqual(view.legend[7].does, "map of worlds")
  }

  func testFan() throws {
    let f = try XCTUnwrap(view.fx)
    XCTAssertEqual(f.title, "aether"); XCTAssertEqual(f.hint, "FX — tap outside to close")
    XCTAssertEqual(f.rows.map(\.label), ["hall", "decay", "delay", "chaos", "drive"])
    XCTAssertEqual(f.rows.map(\.key), ["hall", "decay", "delay", "chaos", "drive"])
    XCTAssertTrue(f.rows.allSatisfy { $0.code == -1 })
    XCTAssertNil(f.lfo); XCTAssertNil(f.reset)
    XCTAssertEqual(f.text("decay"), "3.5 s")
    XCTAssertEqual(f.text("hall"), "30%"); XCTAssertEqual(f.text("drive"), "20%")
    XCTAssertEqual(f.get("decay"), 0.5598901985764996, accuracy: 1e-9)
    XCTAssertEqual(f.get("hall"), 0.3)
    XCTAssertEqual(f.arc?(), 0.3)
    f.set("decay", 0.5)
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 33); XCTAssertEqual(rec.acts[0].i, 0)
    let want = [0.3, 2.898275349237888, 0.3, 0, 0.2]
    for k in 0..<5 { XCTAssertEqual(rec.acts[0].a[k], want[k], accuracy: 1e-9) }
    f.set("hall", 0.7)
    XCTAssertEqual(rec.acts[1].a[0], 0.7); XCTAssertEqual(rec.acts[1].a[1], 2.898275349237888, accuracy: 1e-9, "decay — своё, не зеркала")
    XCTAssertEqual(f.get("hall"), 0.7); XCTAssertEqual(f.arc?(), 0.7)
    XCTAssertEqual(f.text("decay"), "2.9 s")
  }

  func testFanTextHugeFx() throws {                          // конечное, но огромное значение fx из зеркала: подпись не падает
    load { b in b[3] = 1e18; b[4] = 1e300; b[6] = -1e18; b[7] = 3e9 }
    view.tick(now: 1, dt: 0.016)
    let f = try XCTUnwrap(view.fx)
    for k in ["hall", "decay", "delay", "chaos", "drive"] { _ = f.text(k); _ = f.get(k) }
    XCTAssertEqual(f.text("hall"), "1000000%")
  }

  func testRestoredShowsMirror() {                           // своё значение висит, зеркало ушло: после restored видно зеркало, и следующая правка тоже
    load { self.set(&$0, 1, x: 0.3) }
    view.tick(now: 1, dt: 0.016)
    view.send(Act.move, 1, [0.5, 0.5, 0], touchTime: 0)
    load { self.set(&$0, 1, x: 0.8) }
    view.restored()
    XCTAssertEqual(view.voice(1).x, 0.8)
    load { self.set(&$0, 1, x: 0.9) }
    view.tick(now: 1.05, dt: 0.016)
    XCTAssertEqual(view.voice(1).x, 0.9)
  }

  func testHeardTick() {
    heardQ = [[1, 2, 1, 2, 2, 4, 0.8]]
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.waves.count, 1, "две вспышки у одного i за тик — одна")
    XCTAssertEqual(view.waves[0].r, 36); XCTAssertEqual(view.waves[0].a, 1.6); XCTAssertEqual(view.waves[0].sp, 420)
    XCTAssertFalse(view.waves[0].dash)
    XCTAssertEqual(view.strikes.count, 1)
    XCTAssertEqual(view.strikes[0].i, 4); XCTAssertEqual(view.strikes[0].t0, 2); XCTAssertEqual(view.strikes[0].p, 0.8)
    heardQ = [[1, 3], [2, 1, 0.5]]
    view.idle()
    XCTAssertTrue(heardQ.isEmpty, "idle слил кольцо")
    XCTAssertEqual(view.waves.count, 1); XCTAssertEqual(view.strikes.count, 1, "без событий")
  }

  func testHeardTwoFlashesDifferent() {
    heardQ = [[1, 2, 1, 3]]
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.waves.count, 2)
  }

  func testHeardReadLimit() {
    heardQ = Array(repeating: [Double](repeating: 0, count: 255), count: 6)   // буфер 256 почти полон — читаем ещё, но не больше 4 раз
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(heardQ.count, 2)
    heardQ = [[1, 0]]
    view.tick(now: 2.1, dt: 0.016)
    XCTAssertEqual(heardQ.count, 0, "короткая запись — одно чтение")
  }

  func testHeardPastFiveAndHalf() {                          // индекс 5.7 — вне 0…5 после округления: события нет, не падает
    heardQ = [[1, 5.7]]
    view.tick(now: 2, dt: 0.016)
    XCTAssertEqual(view.waves.count, 0)
  }

  func testSunLevel() {
    level = 0.1
    view.tick(now: 1, dt: 0.016)
    XCTAssertEqual(view.sunLevel, 0.22 * 0.08, accuracy: 1e-9)
    for k in 1..<400 { view.tick(now: 1 + Double(k) * 0.016, dt: 0.016) }
    XCTAssertEqual(view.sunLevel, 0.22, accuracy: 1e-3)
    level = 5
    for k in 400..<900 { view.tick(now: 1 + Double(k) * 0.016, dt: 0.016) }
    XCTAssertEqual(view.sunLevel, 1, accuracy: 1e-3, "не больше 1")
  }

  func testDiceEmpty() {
    view.dice()
    XCTAssertEqual(rec.acts.map(\.kind), [16, 24, 34])
    XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[1].i, 0)
    XCTAssertEqual(rec.acts[0].a.count, 3)
    XCTAssertEqual(rec.acts[0].a[0], 0.39010085747339845, accuracy: 1e-6)
    XCTAssertEqual(rec.acts[0].a[1], 0.4, accuracy: 1e-6)
    XCTAssertEqual(rec.acts[0].a[2], 0, accuracy: 1e-9)
    XCTAssertTrue(view.voice(0).pinned, "свои значения сразу")
    XCTAssertEqual(view.state.pinResult(0, mirror: view.mirror, now: 0), PinResult.unpinned, "ответ фасада: уже закреплена")
    XCTAssertEqual(view.vw[0].dx, 0.39010085747339845, accuracy: 1e-6)
  }

  func testDiceLive() {
    load { self.set(&$0, 1) }
    view.tick(now: 1, dt: 0.016)
    view.dice()
    XCTAssertEqual(rec.acts.map(\.kind), [34])
  }

  func testDiceFull() {                                      // три закреплённые и три удерживаемые, все не звучат — ни места, ни живых
    load { b in
      for i in 0..<3 { self.set(&b, i, pinned: true, envT: 0) }
      for i in 3..<6 { self.set(&b, i, held: true, envT: 0) }
    }
    view.tick(now: 1, dt: 0.016)
    XCTAssertEqual(view.state.pick(mirror: view.mirror, now: 1), -1)
    view.dice()
    XCTAssertEqual(rec.acts.map(\.kind), [34], "только DICE (ядро решит само)")
    XCTAssertEqual(view.full.count, 1, "отказ на поле")
  }

  func testClear() {
    view.clear()
    XCTAssertEqual(rec.acts.map(\.kind), [35])
  }

  func testCorner() {
    XCTAssertTrue(view.cornerHit(10, bot - 10))
    XCTAssertFalse(view.cornerHit(60, bot))
    view.sheetVoice = 2
    XCTAssertFalse(view.cornerHit(10, bot - 10), "плашка планеты открыта — солнце не ведёт на карту")
  }

  func testRestored() {
    view.sendSun(1, 0.3, touchTime: 1)
    XCTAssertEqual(rec.acts.map(\.kind), [22]); XCTAssertEqual(rec.acts[0].a, [0.3]); XCTAssertEqual(rec.acts[0].t, 1)
    view.sendSun(1, 0.3, touchTime: 1)
    XCTAssertEqual(rec.acts.count, 1, "повтор не шлём")
    view.restored()
    view.sendSun(1, 0.3, touchTime: 1)
    XCTAssertEqual(rec.acts.count, 2, "после restored кеш сброшен")
    view.enter()
    view.sendSun(1, 0.3, touchTime: 1)
    XCTAssertEqual(rec.acts.count, 3, "enter тоже")
    view.sendSun(1, 0.4, touchTime: 1)
    XCTAssertEqual(rec.acts.count, 4, "изменилось — шлём")
  }

  func testRestoredResetsOwnAndView() {
    load { self.set(&$0, 1, x: 0.6, holeT: 0.4) }
    view.tick(now: 1, dt: 0.016)
    view.send(Act.move, 1, [0.2, 0.2, 0], touchTime: 0)
    view.sheetVoice = 1
    view.restored()
    XCTAssertEqual(view.voice(1).x, 0.6, "свои значения сброшены")
    XCTAssertEqual(view.vw[1].dx, 0.6); XCTAssertEqual(view.vw[1].hole, 0.4)
    XCTAssertNil(view.sheetVoice, "плашка закрыта")
  }

  func testZoomLayout() {
    XCTAssertEqual(view.zoomT, view.geo.zoomDef, accuracy: 1e-12)
    XCTAssertEqual(view.zoomT, 0.8573645219195573, accuracy: 1e-9)
    view.zoomT = 0.5
    view.layout(W: 390, H: 844, topY: 103, safeBot: 34)
    XCTAssertEqual(view.zoomT, 0.5, "ручной зум держится")
    view.layout(W: 430, H: 932, topY: 103, safeBot: 34)
    XCTAssertEqual(view.zoomT, view.geo.zoomDef)
    XCTAssertEqual(view.zoom, view.zoomT, "как resize веба: zoom = zoomT")
  }

  func testZoomSmooth() {
    view.zoomT = 0.5
    let z0 = view.zoom
    view.tick(now: 1, dt: 0.05)
    XCTAssertEqual(view.zoom, z0 + (0.5 - z0) * (1 - exp(-0.05 / 0.06)), accuracy: 1e-9)
    for k in 0..<200 { view.tick(now: 1 + Double(k) * 0.05, dt: 0.05) }
    XCTAssertEqual(view.zoom, 0.5)
  }

  func testDtClamp() {
    view.zoomT = 0.5
    let z0 = view.zoom
    view.tick(now: 1, dt: 3)
    XCTAssertEqual(view.zoom, z0 + (0.5 - z0) * (1 - exp(-0.05 / 0.06)), accuracy: 1e-9, "dt ≤ 0.05")
  }

  // правка зеркала при совпавшем своём значении видна сразу (state.sync в тике)
  func testMirrorChangeAfterConverge() {
    load { self.set(&$0, 1, x: 0.3) }
    view.tick(now: 1, dt: 0.016)
    view.send(Act.move, 1, [0.5, 0.5, 0], touchTime: 0)
    load { self.set(&$0, 1, x: 0.5) }
    view.tick(now: 1.05, dt: 0.016)
    XCTAssertEqual(view.voice(1).x, 0.5)
    load { self.set(&$0, 1, x: 0.7) }
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(view.voice(1).x, 0.7, "ядро сдвинуло планету — не прячем за своим значением")
  }

  func testBadMirrorKeepsOld() {
    load { self.set(&$0, 1, x: 0.3) }
    view.tick(now: 1, dt: 0.016)
    mbuf = [6, 1, 2]
    view.tick(now: 1.1, dt: 0.016)
    XCTAssertEqual(view.voice(1).x, 0.3)
  }

  func testVwFollowsXAndHole() {
    load { self.set(&$0, 1, x: 0.4, holeT: 0.8) }
    view.tick(now: 1, dt: 0.05)
    XCTAssertEqual(view.vw[1].dx, 0.4)
    XCTAssertEqual(view.vw[1].hole, 0.8 * (1 - exp(-0.05 / 0.15)), accuracy: 1e-9)
  }

  func testVwScaleSlide() {
    load { self.set(&$0, 1, x: 0.4) }
    view.tick(now: 1, dt: 0.05)
    view.scale(pcs: [0, 4, 7], root: 0)
    let q = tenQuantX(0.4, pcs: [0, 4, 7], root: 0)
    view.tick(now: 1.05, dt: 0.05)
    XCTAssertEqual(view.vw[1].dx, 0.4 + (q - 0.4) * (1 - exp(-0.05 / 0.07)), accuracy: 1e-9)
    for k in 0..<100 { view.tick(now: 1.1 + Double(k) * 0.05, dt: 0.05) }
    XCTAssertEqual(view.vw[1].dx, q, accuracy: 1e-6)
    view.scale(pcs: nil, root: 0)
    view.tick(now: 6.1, dt: 0.05)
    let d = abs(view.vw[1].dx - 0.4)
    XCTAssertGreaterThan(d, 1e-6, "лад выключили: ещё 0.5 с плавно"); XCTAssertLessThan(d, abs(q - 0.4))
    view.tick(now: 6.7, dt: 0.05)
    XCTAssertEqual(view.vw[1].dx, 0.4, "дальше dx = x")
  }

  func testVwLfo() {
    load { b in
      self.set(&b, 1, x: 0.4)
      let q = Ten.head + Ten.voiceN + 38
      b[q] = 0; b[q + 1] = 4; b[q + 2] = 0.5                  // pitch: morph 0, rate 4, depth 0.5
      b[q + 3] = 0; b[q + 4] = 0.5; b[q + 5] = 0.4            // wave: morph 0, rate .5, depth .4
    }
    view.tick(now: 1, dt: 0.05)
    XCTAssertEqual(view.vw[1].ph[0], 0.2, accuracy: 1e-9)
    XCTAssertEqual(view.vw[1].vph[0], 2.5 * 0.05, accuracy: 1e-9, "фаза вида — не быстрее 2.5 Гц")
    XCTAssertEqual(view.vw[1].ph[1], 0.025, accuracy: 1e-9)
    let val = Waves.morph(0, 0.2) * 0.5
    XCTAssertEqual(view.vw[1].wob, tenXOf(tenSemi(0.4) + val * 7) - 0.4, accuracy: 1e-9)
    XCTAssertEqual(view.vw[1].wv, Waves.morph(0, 0.025) * 0.4, accuracy: 1e-9)
    view.restored()
    XCTAssertEqual(view.vw[1].ph[0], 0, "фазы заново")
  }

  func testWavesFromLive() {
    load { self.set(&$0, 1, x: 0.4, beat: 2, env: 1) }
    var k = 0
    while view.waves.isEmpty && k < 40 { view.tick(now: 1 + Double(k) * 0.05, dt: 0.05); k += 1 }
    XCTAssertEqual(k, 14, "beat 2 Гц → импульс раз в 0.7 с (14 × 0.05)")
    XCTAssertEqual(view.waves.count, 4, "импульс и три эха delay (0.3·1.6·0.46^k > 0.04)")
    XCTAssertEqual(view.waves.filter(\.dash).count, 3)
    let w = view.waves.first { !$0.dash }!
    XCTAssertEqual(w.a, 0.7, accuracy: 1e-9)
    XCTAssertEqual(w.sp, 40 + tenFreq(0.4) * 0.1, accuracy: 1e-9)
  }

  func testWavesNotFromDeadOrHole() {
    load { b in self.set(&b, 1, env: 0.01); self.set(&b, 2, beat: 2, holeT: 0.9); self.set(&b, 3, active: false) }
    for k in 0..<40 { view.tick(now: 1 + Double(k) * 0.05, dt: 0.05) }
    XCTAssertEqual(view.waves.count, 0)
  }

  func testWavesCapAndFade() {
    for _ in 0..<60 { view.waves.append(TenWave(x: 0, y: 0, r: 36, a: 1, sp: 0, dash: false)) }
    load { self.set(&$0, 1, beat: 2) }
    for k in 0..<40 { view.tick(now: 1 + Double(k) * 0.05, dt: 0.05) }
    XCTAssertEqual(view.waves.count, 60, "не больше 60")
    view.waves = [TenWave(x: 0, y: 0, r: 36, a: 1, sp: 2000, dash: false)]
    load { _ in }
    mbuf = mirror()
    for k in 0..<12 { view.tick(now: 4 + Double(k) * 0.05, dt: 0.05) }
    XCTAssertEqual(view.waves.count, 0, "дальше Rmax волна уходит")
  }

  func testObjs() {
    load { b in self.set(&b, 0); self.set(&b, 4) }
    view.tick(now: 1, dt: 0.016)
    XCTAssertEqual(view.objs, 2)
  }

  func testVoiceOutOfRangeSafe() {
    XCTAssertEqual(view.voice(-1), TenVoiceM()); XCTAssertEqual(view.voice(9), TenVoiceM())
  }
}
