import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

final class MonochordTests: XCTestCase {
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private var heardBuf: [Double] = []
  private let f1 = NSObject(), f2 = NSObject()
  private lazy var view = MonochordView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    let n = min(self.heardBuf.count, b.count); b.replaceSubrange(0..<n, with: self.heardBuf[0..<n]); self.heardBuf = []; return n
  })
  private var G: MonoGeo { view.geo }
  private var opened: [SheetSpec] = []

  override func setUp() { view.openSheet = { [unowned self] s in self.opened.append(s) } }

  // зеркало: fx 7, ветер, lastWind, auto 6, шаг, четыре струны по 9 чисел
  private func setMirror(wind: Double = 0, lastWind: Double = 0.5, auto: [Double] = [0, 90, 1, 1, 0.6, 0],
                         r: [Double] = [1, 2.0 / 3, 0.5, 1.0 / 3], bow: [Double] = [0, 0, 0, 0], sus: [Double] = [0, 0, 0, 0], now: Double = 1) {
    var b: [Double] = [0.55, 0.55, 0.4, 0.4, 0, 1, 0.35, wind, lastWind] + auto + [0]
    for i in 0..<4 { b += [r[i], sus[i], 0.5, 0.6, 0.8, bow[i], 0.01, 0.02, 3] }
    mirrorBuf = b; view.tick(now: now, dt: 0.016)
  }
  private func finger(_ o: NSObject, _ p: CGPoint, t0: Double = 0, now: Double = 0, p0: CGPoint? = nil) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: t0, moved: false, touchTime: now)
  }
  private func yb(_ i: Int) -> CGFloat { G.yOfR(view.mirror.str[i].r) }
  private func onString(_ i: Int, u: Double, dx: CGFloat = 0) -> CGPoint { CGPoint(x: G.xs[i] + dx, y: G.y0 + CGFloat(u) * (yb(i) - G.y0)) }
  private var windPt: CGPoint { CGPoint(x: G.aeolus.x, y: G.aeolus.y) }
  private var earthPt: CGPoint { CGPoint(x: G.earth.x, y: G.earth.y - 10) }

  func testMirrorParse() {
    var b: [Double] = [1, 2, 3, 4, 5, 6, 7, 0.4, 0.8] + [1, 120, 2, 3, 0.7, 0.2] + [9]
    for i in 0..<4 { b += (0..<9).map { Double(i * 10 + $0) + 0.5 } }
    let m = MonoMirror(b, n: 52)!
    XCTAssertEqual(m.fx, [1, 2, 3, 4, 5, 6, 7]); XCTAssertEqual(m.wind, 0.4); XCTAssertEqual(m.lastWind, 0.8)
    XCTAssertEqual(m.auto, [1, 120, 2, 3, 0.7, 0.2]); XCTAssertEqual(m.step, 9)
    let s = m.str[2]
    XCTAssertEqual([s.r, s.bright, s.decay, s.level, s.bow, s.en, s.eh, s.hn], [20.5, 22.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5])
    XCTAssertTrue(s.sus); XCTAssertNil(MonoMirror(b, n: 51))
  }

  func testHeardFlash() {
    setMirror(now: 3)
    heardBuf = [1, 5]; view.tick(now: 4, dt: 0.016)
    XCTAssertEqual(view.hitAt, 4)
    heardBuf = []; view.tick(now: 5, dt: 0.016)
    XCTAssertEqual(view.hitAt, 4, "без ударов вспышка не обновляется")
    let v2 = MonochordView(core: rec, readMirror: { _ in 0 }, readHeard: { [unowned self] b in
      let n = min(self.heardBuf.count, b.count); b.replaceSubrange(0..<n, with: self.heardBuf[0..<n]); self.heardBuf = []; return n })
    heardBuf = [1, 5]; v2.idle()
    XCTAssertLessThan(v2.hitAt, 0, "idle сливает heard без вспышки"); XCTAssertTrue(heardBuf.isEmpty)
  }

  func testPluck() {
    setMirror()
    let p = onString(1, u: 0.2)
    view.down(finger(f1, p, t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1)
    let a = rec.acts[0]
    XCTAssertEqual([a.kind, a.i], [0, 1]); XCTAssertEqual(a.a[0], Double((p.y - G.y0) / (yb(1) - G.y0)), accuracy: 1e-6); XCTAssertEqual(a.a[1], 0.9)
  }

  func testHarmonic() {
    setMirror()
    view.down(finger(f1, onString(1, u: 0.5), t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [1, 1]); XCTAssertEqual(rec.acts[0].a, [2, 0.9])
  }

  func testDoubleTapSus() {
    setMirror()
    let p = onString(1, u: 0.2)
    view.down(finger(f1, p, t0: 5, now: 5)); view.up(finger(f1, p, t0: 5, now: 5.05))
    view.down(finger(f1, p, t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.map(\.kind), [0, 3]); XCTAssertEqual(rec.acts[1].i, 1); XCTAssertEqual(rec.acts[1].a, [1])
    view.up(finger(f1, p, t0: 5.2, now: 5.25))
    XCTAssertEqual(rec.acts.count, 2, "lastTap сброшен, подъём ничего не шлёт")
    view.down(finger(f1, p, t0: 5.3, now: 5.3))
    XCTAssertEqual(rec.acts.last?.kind, 0, "третий тап — снова щипок")
  }

  func testDoubleTapOnSingingStringStopsIt() {
    setMirror(sus: [0, 1, 0, 0])
    let p = onString(1, u: 0.2)
    view.down(finger(f1, p, t0: 5, now: 5)); view.up(finger(f1, p, t0: 5, now: 5.05))
    view.down(finger(f1, p, t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.last?.kind, 3); XCTAssertEqual(rec.acts.last?.a, [0])
  }

  func testDoubleTapOtherString() {
    setMirror()
    view.down(finger(f1, onString(0, u: 0.2), t0: 5, now: 5)); view.up(finger(f1, onString(0, u: 0.2), t0: 5, now: 5.05))
    view.down(finger(f1, onString(1, u: 0.2), t0: 5.1, now: 5.1))
    XCTAssertEqual(rec.acts.map(\.kind), [0, 0]); XCTAssertEqual(rec.acts.map(\.i), [0, 1], "I, потом II — два щипка, не SUS")
    view.up(finger(f1, onString(1, u: 0.2), t0: 5.1, now: 5.15))
    view.down(finger(f1, onString(1, u: 0.2), t0: 6, now: 6))   // позже dtapMs — тоже щипок
    XCTAssertEqual(rec.acts.map(\.kind), [0, 0, 0])
  }

  func testBridgeDrag() {
    setMirror()
    let p = CGPoint(x: G.xs[0], y: yb(0) + 5)
    view.down(finger(f1, p, t0: 5, now: 5))
    XCTAssertTrue(rec.acts.isEmpty)
    let q = CGPoint(x: G.xs[0], y: G.y0 + 0.6 * (G.y1 - G.y0))
    view.move(finger(f1, q, t0: 5, now: 5.1, p0: p))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [4, 0])
    XCTAssertEqual(rec.acts[0].a, [G.rOfY(q.y)]); XCTAssertEqual(rec.acts[0].a[0], 0.6, accuracy: 1e-9)
    XCTAssertEqual(G.rOfY(G.y0), 0.25); XCTAssertEqual(G.rOfY(G.y1 + 50), 1)
  }

  func testBridgeAndPluckTwoFingers() {
    setMirror()
    let b = CGPoint(x: G.xs[0], y: yb(0)), s = onString(1, u: 0.2)
    view.down(finger(f1, b, t0: 5, now: 5))
    view.down(finger(f2, s, t0: 5.02, now: 5.02))
    XCTAssertEqual(rec.acts.map(\.kind), [0]); XCTAssertEqual(rec.acts[0].i, 1, "второй палец щиплет соседнюю струну")
    let b2 = CGPoint(x: G.xs[0], y: yb(0) + 40)
    view.move(finger(f1, b2, t0: 5, now: 5.1, p0: b))
    XCTAssertEqual(rec.acts.map(\.kind), [0, 4]); XCTAssertEqual(rec.acts[1].i, 0)
    view.move(finger(f2, CGPoint(x: s.x + 3, y: s.y), t0: 5.02, now: 5.12, p0: s))
    XCTAssertEqual(rec.acts.count, 2, "палец-щипок кобылку не двигает")
    view.move(finger(f1, CGPoint(x: G.xs[1] + 4, y: s.y), t0: 5, now: 5.2, p0: b))   // палец кобылки пересёк струну II выше её кобылки
    XCTAssertEqual(rec.acts.map(\.kind), [0, 4, 4], "палец кобылки не щиплет")
  }

  func testBow() {
    setMirror()
    let p = onString(1, u: 0.2)
    view.tick(now: 5, dt: 0.016)
    view.down(finger(f1, p, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: p.x + 12, y: p.y), t0: 5, now: 5.05, p0: p))
    XCTAssertEqual(rec.acts.count, 1, "до 150 мс — ещё не смычок")
    view.move(finger(f1, CGPoint(x: p.x - 4, y: p.y), t0: 5, now: 5.1, p0: p))   // повёл назад — смычок сразу
    XCTAssertEqual(rec.acts.last?.kind, 2); XCTAssertEqual(rec.acts.last?.i, 1)
    let amp = rec.acts.last!.a[0]; XCTAssertTrue(amp > 0 && amp <= 1)
    let n = rec.acts.count
    view.tick(now: 5.4, dt: 0.016)
    view.move(finger(f1, CGPoint(x: p.x + 12, y: p.y), t0: 5, now: 5.4, p0: p))
    XCTAssertEqual(rec.acts.count, n + 1); XCTAssertEqual(rec.acts.last?.kind, 2)
    setMirror(bow: [0, 0.5, 0, 0], now: 5.45)
    view.tick(now: 5.9, dt: 0.016)
    XCTAssertEqual(rec.acts.count, n + 1, "двигавшийся палец смычок не гасит: как в вебе (view.js:129-133)")
    view.up(finger(f1, p, t0: 5, now: 5.7))
    XCTAssertEqual(rec.acts.last?.a, [0], "подъём снимает смычок")
  }

  func testStrum() {
    setMirror()
    let st = CGPoint(x: G.xs[1], y: yb(1) + 30)                                // ниже кобылки — страм можно начать
    view.down(finger(f1, st, t0: 5, now: 5))
    XCTAssertTrue(rec.acts.isEmpty)
    view.move(finger(f1, CGPoint(x: G.xs[3] + 5, y: G.y0 + 60), t0: 5, now: 5.1, p0: st))
    XCTAssertEqual(rec.acts.map(\.kind), [0, 0]); XCTAssertEqual(rec.acts.map(\.i), [2, 3])
    for a in rec.acts { XCTAssertTrue(a.a[1] >= 0.3 && a.a[1] <= 1); XCTAssertTrue(a.a[0] > 0 && a.a[0] < 1) }
  }

  func testStrumSkipsBelowBridge() {
    setMirror()
    let st = CGPoint(x: G.xs[1], y: yb(1) + 30)
    view.down(finger(f1, st, t0: 5, now: 5))
    let y = G.y0 + 0.4 * (G.y1 - G.y0)                                         // выше кобылки II (0.5), ниже кобылки IV (⅓)
    view.move(finger(f1, CGPoint(x: G.xs[3] + 5, y: y), t0: 5, now: 5.1, p0: st))
    XCTAssertEqual(rec.acts.map(\.kind), [0]); XCTAssertEqual(rec.acts.map(\.i), [2], "ниже своей кобылки — без щипка")
  }

  func testStrumFromStringStopsBow() {
    setMirror(bow: [0, 0.5, 0, 0])
    let p = onString(1, u: 0.2)
    view.down(finger(f1, p, t0: 5, now: 5)); rec.acts.removeAll()
    view.move(finger(f1, CGPoint(x: G.xs[2] + 5, y: p.y), t0: 5, now: 5.05, p0: p))
    XCTAssertEqual(rec.acts.map(\.kind), [0, 2]); XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[1].a, [0])
  }

  func testWindDrag() {
    setMirror(wind: 0.2)
    view.down(finger(f1, windPt, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: windPt.x, y: windPt.y - 4), t0: 5, now: 5.05, p0: windPt))
    XCTAssertTrue(rec.acts.isEmpty, "мёртвая зона 6 px")
    view.move(finger(f1, CGPoint(x: windPt.x, y: windPt.y - 70), t0: 5, now: 5.1, p0: windPt))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a[0], 0.7, accuracy: 1e-9)
    view.up(finger(f1, windPt, t0: 5, now: 5.2))
    XCTAssertEqual(rec.acts.count, 1, "после протяжки подъём ветер не переключает")
  }

  func testWindTap() {
    setMirror(wind: 0, lastWind: 0.6)
    view.down(finger(f1, windPt, t0: 5, now: 5)); view.up(finger(f1, windPt, t0: 5, now: 5.05))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a, [0.6])
    setMirror(wind: 0.3, lastWind: 0.3, now: 2); rec.acts.removeAll()
    view.down(finger(f1, windPt, t0: 6, now: 6)); view.up(finger(f1, windPt, t0: 6, now: 6.05))
    XCTAssertEqual(rec.acts[0].a, [0])
  }

  func testEarthTap() {
    setMirror()
    view.down(finger(f1, earthPt, t0: 5, now: 5)); view.up(finger(f1, earthPt, t0: 5, now: 5.05))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 8); XCTAssertEqual(rec.acts[0].a, [1])
    setMirror(auto: [1, 90, 1, 1, 0.6, 0], now: 2); rec.acts.removeAll()
    view.down(finger(f1, earthPt, t0: 6, now: 6)); view.up(finger(f1, earthPt, t0: 6, now: 6.05))
    XCTAssertEqual(rec.acts[0].a, [0])
  }

  func testEarthHoldNoToggle() {
    setMirror(now: 5)
    view.down(finger(f1, earthPt, t0: 5, now: 5))
    view.tick(now: 5.5, dt: 0.016)
    XCTAssertEqual(opened.map(\.title), ["terra"])
    view.up(finger(f1, earthPt, t0: 5, now: 5.6))
    XCTAssertTrue(rec.acts.isEmpty, "подъём после плашки земли автострам не переключает")
  }

  func testHoldsOpenSheets() {
    setMirror(now: 5)
    view.down(finger(f1, windPt, t0: 5, now: 5)); view.tick(now: 5.5, dt: 0.016)
    XCTAssertEqual(opened.map(\.title), ["ventus"]); view.up(finger(f1, windPt, t0: 5, now: 5.6))
    XCTAssertTrue(rec.acts.isEmpty)
    view.tick(now: 6, dt: 0.016)
    view.down(finger(f1, onString(1, u: 0.2), t0: 6, now: 6)); view.tick(now: 6.5, dt: 0.016)
    XCTAssertEqual(opened.map(\.title), ["ventus", "chorda II"])
    view.tick(now: 7, dt: 0.016)
    XCTAssertEqual(opened.count, 2, "плашка открывается раз")
  }

  func testStringMovedNoSheet() {
    setMirror(now: 5)
    let p = onString(1, u: 0.2)
    view.down(finger(f1, p, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: p.x + 12, y: p.y), t0: 5, now: 5.05, p0: p))
    view.tick(now: 5.5, dt: 0.016)
    XCTAssertTrue(opened.isEmpty)
  }

  func testCornerHit() {
    let h = G.hand
    XCTAssertTrue(view.cornerHit(h.x, h.y)); XCTAssertTrue(view.cornerHit(h.x + h.r * 1.05, h.y))
    XCTAssertFalse(view.cornerHit(h.x + h.r * 1.2, h.y)); XCTAssertFalse(view.cornerHit(G.xs[0], G.y0))
  }

  func testStringAt() {
    XCTAssertEqual(G.stringAt(G.xs[2] + 10, G.y0 + 50), 2)
    XCTAssertNil(G.stringAt(G.xs[0] - 40, G.y0 + 50)); XCTAssertNil(G.stringAt(G.xs[1], G.y0 - 20)); XCTAssertNil(G.stringAt(G.xs[1], G.y1 + 20))
  }

  // ---------- плашки ----------
  func testStringSheet() {
    setMirror()
    let s = view.stringSpec(2)
    XCTAssertEqual(s.title, "chorda III")
    XCTAssertEqual(s.rows.map(\.code), [18, 19, 20, 21]); XCTAssertEqual(s.rows[0].key, "pitch"); XCTAssertEqual(s.rows[3].key, "level")
    XCTAssertEqual(s.lfo?.obj, -1); XCTAssertEqual(s.lfo?.shape, 0); XCTAssertEqual(s.lfo?.keys, ["pitch", "bright", "decay", "level"])
    XCTAssertEqual(s.get("pitch"), 0.5, accuracy: 1e-12, "log2(1/r)/2")
    XCTAssertEqual(s.get("level"), 0.8); XCTAssertEqual(s.text("level"), "80%")
    s.set("pitch", 0.3); s.set("decay", 0.7)
    XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [5, 2]); XCTAssertEqual(rec.acts[0].a, [0, 0.3])
    XCTAssertEqual(rec.acts[1].a, [2, 0.7])
    XCTAssertEqual(s.text("pitch"), "A3", "110 Гц / ½ = 220 Гц")
    view.scale(pcs: nil, root: 3)
    XCTAssertEqual(s.text("pitch"), "C4", "тоника сдвигает подпись")
  }

  func testEarthSheet() {
    setMirror()
    let s = view.earthSpec()
    XCTAssertEqual(s.title, "terra")
    XCTAssertEqual(s.rows.map(\.key), ["tempo", "rate", "pattern", "strength", "swing"])
    XCTAssertEqual(s.rows[3].code, 8); XCTAssertEqual(s.rows[4].code, 9)
    XCTAssertEqual(s.lfo?.keys, ["strength", "swing"]); XCTAssertEqual(s.lfo?.obj, -1)
    XCTAssertEqual(s.get("tempo"), 50.0 / 160); XCTAssertEqual(s.text("tempo"), "90 bpm")
    XCTAssertEqual(s.get("rate"), 0.375); XCTAssertEqual(s.text("rate"), "1/8"); XCTAssertEqual(s.text("pattern"), "down-up")
    s.set("tempo", 0.5); s.set("rate", 0.3); s.set("rate", 0.99); s.set("pattern", 0.6); s.set("strength", 0.25); s.set("swing", 0.1)
    XCTAssertTrue(rec.acts.allSatisfy { $0.kind == 9 })
    XCTAssertEqual(rec.acts.map(\.i), [1, 2, 2, 3, 4, 5])
    XCTAssertEqual(rec.acts.map { $0.a[0] }, [120, 1, 3, 2, 0.25, 0.1])
  }

  func testWindSheet() {
    setMirror(wind: 0.34)
    let s = view.windSpec()
    XCTAssertEqual(s.title, "ventus"); XCTAssertEqual(s.rows.map(\.code), [7]); XCTAssertEqual(s.lfo?.shape, 1); XCTAssertEqual(s.lfo?.obj, -1)
    XCTAssertEqual(s.get("wind"), 0.34); XCTAssertEqual(s.text("wind"), "34%")
    s.set("wind", 0.8); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a, [0.8])
    setMirror(wind: 0, now: 2); XCTAssertEqual(s.text("wind"), "calm")
  }

  func testFanSheet() {
    setMirror()
    let s = view.fx!
    XCTAssertEqual(s.rows.map(\.key), ["decay", "bright", "body", "sympathy", "chorus", "chance", "hall"])
    XCTAssertEqual(s.rows.map(\.code), [0, 1, 2, 3, 4, 5, 6]); XCTAssertEqual(s.lfo?.shape, 0); XCTAssertEqual(s.lfo?.obj, -1)
    XCTAssertEqual(s.get("hall"), 0.35); XCTAssertEqual(s.text("hall"), "35%"); XCTAssertEqual(s.arc?(), 0.35)
    s.set("body", 0.9); XCTAssertEqual([rec.acts[0].kind, rec.acts[0].i], [7, 2]); XCTAssertEqual(rec.acts[0].a, [0.9])
  }

  func testLegend() {
    XCTAssertEqual(view.legend.count, 10)
    XCTAssertEqual(view.legend[0].gesture, "tap a string above its bridge"); XCTAssertEqual(view.legend[9].does, "map of worlds")
  }

  func testDice() {
    view.dice()
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 11)
  }

  func testClearOrder() {
    var log: [String] = []
    view.rowLfoOff = { [unowned self] code in log.append("off\(code)@\(self.rec.acts.count)") }
    view.clear()
    XCTAssertEqual(log, ["off7@0"], "LFO ветра снят раньше CLEAR")
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 10)
  }
}

extension MonochordTests {
  func testFadeOnlyForUnmovedFinger() {
    setMirror(bow: [0, 0.5, 0, 0], now: 5)
    view.down(Finger(id: ObjectIdentifier(f1), x: G.xs[1], y: G.y0 + 0.2 * (G.yOfR(2.0 / 3) - G.y0), x0: 0, y0: 0, t0: 5, moved: false, touchTime: 5))
    rec.acts.removeAll()
    view.tick(now: 5.1, dt: 0.016); XCTAssertTrue(rec.acts.isEmpty)
    view.tick(now: 5.2, dt: 0.016)
    XCTAssertEqual(rec.acts.last?.kind, 2); XCTAssertEqual(rec.acts.last?.a[0] ?? 0, 0.4, accuracy: 1e-9)
  }

  private func startBow() -> CGPoint {
    setMirror()
    let p = onString(1, u: 0.2)
    view.tick(now: 5, dt: 0.016)
    view.down(finger(f1, p, t0: 5, now: 5))
    view.move(finger(f1, CGPoint(x: p.x + 12, y: p.y), t0: 5, now: 5.05, p0: p))
    view.move(finger(f1, CGPoint(x: p.x - 4, y: p.y), t0: 5, now: 5.1, p0: p))
    XCTAssertEqual(rec.acts.last?.kind, 2)
    return p
  }

  func testRestoredEndsBow() {
    _ = startBow()
    view.restored()
    XCTAssertEqual(rec.acts.last?.kind, 2); XCTAssertEqual(rec.acts.last?.i, 1); XCTAssertEqual(rec.acts.last?.a, [0], "undo не оставляет смычок в ядре")
  }

  func testCancelEndsBow() {
    let p = startBow()
    view.cancel(finger(f1, p, t0: 5, now: 5.2))
    XCTAssertEqual(rec.acts.last?.kind, 2); XCTAssertEqual(rec.acts.last?.i, 1); XCTAssertEqual(rec.acts.last?.a, [0])
  }

  func testFxTitleIsAether() { XCTAssertEqual(view.fx?.title, "aether") }

  func testNonLfoRowCodesAreFree() {
    let specs = [view.earthSpec(), view.windSpec(), view.stringSpec(0), view.fx!]
    for s in specs { for r in s.rows where s.lfo?.keys.contains(r.key) != true { XCTAssertFalse((0...25).contains(r.code), "\(s.title) \(r.key)") } }
    XCTAssertEqual(view.earthSpec().rows.filter { !(0...25).contains($0.code) }.map(\.key), ["tempo", "rate", "pattern"])
  }

  func testHeldQueries() {
    setMirror(now: 5)
    view.down(finger(f1, CGPoint(x: G.xs[0], y: yb(0)), t0: 5, now: 5))
    XCTAssertNotNil(view.held(0)); XCTAssertNil(view.held(1)); XCTAssertTrue(view.bridgeHeld(0)); XCTAssertFalse(view.bridgeHeld(1))
  }

  // ---------- рисование ----------
  private func render(_ v: MonochordView, now: Double) {
    let W = Int(v.geo.W), H = Int(v.geo.H)
    let g = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: W * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    g.translateBy(x: 0, y: CGFloat(H)); g.scaleBy(x: 1, y: -1)
    let d = Draw(g: g, W: CGFloat(W), H: CGFloat(H)); d.setTheme(v.theme)
    v.draw(d, now: now)
  }

  func testWallCached() {
    setMirror()
    render(view, now: 1); render(view, now: 1.1)
    XCTAssertEqual(view.wallBuilds, 1, "два кадра — одна стена")
    view.layout(W: 390, H: 800, topY: 59, safeBot: 34); render(view, now: 1.2)
    XCTAssertEqual(view.wallBuilds, 2, "высота сменилась")
  }

  func testDrawNoCrashEmpty() {
    mirrorBuf = []; view.tick(now: 1, dt: 0.016)       // мир ещё не отдал снимок — зеркало по умолчанию
    render(view, now: 1)
    XCTAssertEqual(view.wallBuilds, 1)
  }

  func testWaveBufferReused() {
    setMirror()
    render(view, now: 1); let a = view.waveBase
    render(view, now: 1.1); render(view, now: 1.2)
    XCTAssertNotNil(a); XCTAssertEqual(view.waveBase, a, "буфер волны — один между кадрами")
    XCTAssertEqual(view.waveCount, 41)
  }
}
