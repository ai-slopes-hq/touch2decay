import XCTest

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return true }
}

// касания Natura: кувшинки, вода, glide, пристань, плотина, облако, горы, утки, дерево, птицы, лягушка, челнок, меню цветков (view.js:162-301, 330-337)
final class NatTouchTests: XCTestCase {
  private typealias A = Nat.Act
  private typealias P = (x: Double, y: Double)
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private lazy var view = NaturaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, rng: { 0.5 })
  private var opened: [SheetSpec] = []
  private var gone: [Int] = []
  private let f1 = NSObject(), f2 = NSObject(), f3 = NSObject()

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.openSheet = { [unowned self] s in self.opened.append(s) }
    view.objGone = { [unowned self] i in self.gone.append(i) }
    view.tick(now: 1.0, dt: 0.016)
  }

  private var G: NatGeo { view.geo }
  private func F(_ o: NSObject, _ p: P, t: Double = 0) -> Finger {   // p — координаты сцены; палец — со сдвигом ox
    let x = CGFloat(p.x + G.ox), y = CGFloat(p.y)
    return Finger(id: ObjectIdentifier(o), x: x, y: y, x0: x, y0: y, t0: 0, moved: false, touchTime: t)
  }
  private func pp(_ i: Int, _ n: Int) -> P { let p = G.padXY(i, n); return (p.x, p.y) }
  private func off(_ p: P, _ dx: Double, _ dy: Double = 0) -> P { (p.x + dx, p.y + dy) }
  private func tap(_ o: NSObject, _ p: P) { view.down(F(o, p)); view.up(F(o, p)) }
  private func kinds() -> [Int] { rec.acts.map(\.kind) }
  private func count(_ k: Int) -> Int { rec.acts.filter { $0.kind == k }.count }
  private func mirror(playing: Bool = false, fx: [Int: Double] = [:]) -> [Double] {
    var b = [Double](repeating: 0, count: Nat.mirrorN)
    b[0] = playing ? 0 : -1; b[1] = playing ? 1 : 0; b[4] = 96; b[5] = 12
    for k in 0..<Nat.fxDef.count { b[7 + k] = fx[k] ?? Nat.fxDef[k] }
    for i in 0..<Nat.npad {
      let o = Nat.head + i * Nat.padN
      for k in 4...8 { b[o + k] = -1 }
      if let d = Nat.demo.first(where: { $0.i == i }) { b[o] = 1; b[o + 1] = Double(d.note); b[o + 2] = Double(d.wave) }
    }
    return b
  }
  // держим челнок дома 0.43 с: меню цветков открыто, палец ещё лежит
  private func openMenu(_ o: NSObject) {
    view.down(F(o, G.skiffHome()))
    view.tick(now: view.now + 0.43, dt: 0.43)
  }
  // бросок челнока к центру пруда: четыре точки за 60 мс
  private func throwSkiff(_ o: NSObject, t: Double) {
    let s: P = (view.skiff.x, view.skiff.y), pd = G.pond()
    let d = hypot(pd.x - s.x, pd.y - s.y), ux = (pd.x - s.x) / d, uy = (pd.y - s.y) / d
    view.down(F(o, s, t: t))
    for k in 1...4 { view.move(F(o, (s.x + ux * 20 * Double(k), s.y + uy * 20 * Double(k)), t: t + 0.02 * Double(k))) }
    view.up(F(o, (s.x + ux * 80, s.y + uy * 80), t: t + 0.08))
  }

  func testTapWaterPlants() {
    tap(f1, pp(1, 10))
    XCTAssertEqual(kinds(), [A.plant, A.hear])
    XCTAssertEqual(rec.acts[0].i, 1); XCTAssertEqual(rec.acts[0].a, [10, 0]); XCTAssertEqual(rec.acts[1].i, 1)
    XCTAssertTrue(view.pad(1).on)
    rec.acts.removeAll()
    openMenu(f2)                                           // цветок 3 из меню
    view.up(F(f2, view.menuOpts()[3]))
    XCTAssertEqual(view.state.lastWave, 3)
    rec.acts.removeAll()
    tap(f1, pp(10, 14))
    XCTAssertEqual(kinds(), [A.plant, A.hear]); XCTAssertEqual(rec.acts[0].i, 10); XCTAssertEqual(rec.acts[0].a, [14, 3])
  }

  func testTapLilyRemoves() {
    tap(f1, pp(2, 7))
    XCTAssertEqual(kinds(), [A.remove]); XCTAssertEqual(rec.acts[0].i, 2)
    XCTAssertFalse(view.pad(2).on)
  }

  func testHoldLilySheet() {
    view.down(F(f1, pp(2, 7)))
    view.tick(now: 1.2, dt: 0.2)
    XCTAssertTrue(opened.isEmpty)                          // 0.2 с — рано
    view.tick(now: 1.43, dt: 0.23)
    XCTAssertEqual(opened.count, 1)
    XCTAssertTrue(opened[0].title.hasPrefix("lily 3 · "))
    XCTAssertEqual(opened[0].title, view.lilySpec(2).title)
    view.tick(now: 1.6, dt: 0.17)
    XCTAssertEqual(opened.count, 1)                        // плашка один раз
    view.up(F(f1, pp(2, 7)))
    XCTAssertEqual(kinds(), [])                            // без REMOVE на up
    XCTAssertTrue(view.pad(2).on)
  }

  func testHoldMovedNoSheet() {
    view.down(F(f1, pp(2, 7)))
    view.move(F(f1, off(pp(2, 7), 3)))                     // < 8 px — ничего, плашка откроется
    XCTAssertEqual(kinds(), [])
    view.up(F(f1, off(pp(2, 7), 3)))
    XCTAssertEqual(kinds(), [A.remove])                    // сдвиг < 8 px — всё ещё тап
    rec.acts.removeAll()
    view.down(F(f2, pp(3, 5)))
    view.move(F(f2, pp(3, 9)))                             // сдвинули — плашки нет
    rec.acts.removeAll()
    view.tick(now: 1.5, dt: 0.5)
    XCTAssertTrue(opened.isEmpty)
    view.up(F(f2, pp(3, 9)))
    XCTAssertFalse(kinds().contains(A.remove))
  }

  func testDragLilyNote() {
    view.down(F(f1, pp(2, 7)))
    view.move(F(f1, off(pp(2, 7), 5)))                     // < 8 px — ничего
    XCTAssertEqual(kinds(), [])
    view.move(F(f1, pp(2, 10)))
    XCTAssertEqual(kinds(), [A.note, A.hear])
    XCTAssertEqual(rec.acts[0].i, 2); XCTAssertEqual(rec.acts[0].a, [10]); XCTAssertEqual(rec.acts[1].i, 2)
    view.move(F(f1, off(pp(2, 10), 1)))                    // нота та же — ничего нового
    XCTAssertEqual(rec.acts.count, 2)
    view.move(F(f1, pp(2, 11)))
    XCTAssertEqual(kinds(), [A.note, A.hear, A.note, A.hear]); XCTAssertEqual(rec.acts[2].a, [11])
    view.up(F(f1, pp(2, 11)))
    XCTAssertEqual(rec.acts.count, 4)                      // без REMOVE
    XCTAssertEqual(view.pad(2).note, 11)
  }

  func testMoveSkipsBusy() {
    view.down(F(f1, pp(3, 5)))
    view.move(F(f1, pp(5, 5)))                             // место 5 занято (нота 11): MOVE не шлётся, ноты нет — не менялась
    XCTAssertEqual(kinds(), [])
    XCTAssertTrue(view.pad(5).on); XCTAssertEqual(view.pad(5).note, 11)
    view.move(F(f1, pp(5, 8)))                             // над занятым — нота кувшинки 3 следует за пальцем (view.js:241-242)
    XCTAssertEqual(kinds(), [A.note, A.hear]); XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [8])
    XCTAssertFalse(rec.acts.contains { $0.kind == A.move })
    rec.acts.removeAll()
    view.move(F(f1, pp(7, 9)))                             // место 7 свободно
    XCTAssertEqual(kinds(), [A.move, A.note, A.hear])
    XCTAssertEqual(rec.acts[0].i, 3); XCTAssertEqual(rec.acts[0].a, [7])
    XCTAssertEqual(rec.acts[1].i, 7); XCTAssertEqual(rec.acts[1].a, [9]); XCTAssertEqual(rec.acts[2].i, 7)
    rec.acts.removeAll()
    view.move(F(f1, pp(7, 10)))                            // дальше — ноты места 7
    XCTAssertEqual(kinds(), [A.note, A.hear]); XCTAssertEqual(rec.acts[0].i, 7); XCTAssertEqual(rec.acts[0].a, [10])
    view.up(F(f1, pp(7, 10)))
    XCTAssertEqual(count(A.remove), 0)
    XCTAssertFalse(view.pad(3).on)
    XCTAssertTrue(view.pad(7).on); XCTAssertEqual(view.pad(7).note, 10)
    XCTAssertTrue(view.pad(5).on); XCTAssertEqual(view.pad(5).note, 11)   // 5 цела
  }

  func testGlideDraw() {
    func stroke(_ o: NSObject) {
      view.down(F(o, pp(7, 14)))                           // вода: место 7 пусто, нота у берега
      view.move(F(o, pp(6, 9)))
      view.move(F(o, pp(5, 11)))
      view.move(F(o, pp(4, 14)))
      view.up(F(o, pp(4, 14)))
    }
    stroke(f1)
    XCTAssertEqual(kinds(), [A.pglide, A.pglide])
    XCTAssertEqual(rec.acts.map(\.i).sorted(), [5, 6]); XCTAssertEqual(rec.acts.map(\.a), [[1], [1]])
    XCTAssertNotNil(view.wake)
    XCTAssertTrue(view.pad(5).glide); XCTAssertTrue(view.pad(6).glide)
    rec.acts.removeAll()
    stroke(f1)
    XCTAssertEqual(kinds(), [A.pglide, A.pglide]); XCTAssertEqual(rec.acts.map(\.a), [[0], [0]])
  }

  func testGlideNothingNoPlant() {
    view.down(F(f1, pp(7, 14)))
    view.move(F(f1, pp(9, 14))); view.move(F(f1, pp(11, 14)))
    view.up(F(f1, pp(11, 14)))
    XCTAssertEqual(kinds(), [])                            // провели по воде мимо кувшинок: ни глайда, ни посадки
  }

  func testPier() {
    let q = G.pier()
    tap(f1, off(q, 4))
    XCTAssertEqual(kinds(), [A.play]); XCTAssertEqual(rec.acts[0].a, [1])
    rec.acts.removeAll()
    view.down(F(f1, off(q, 4)))
    view.move(F(f1, off(q, 44)))
    view.up(F(f1, off(q, 44)))
    XCTAssertEqual(kinds(), [A.setbpm]); XCTAssertEqual(rec.acts[0].a, [116])
    XCTAssertEqual(view.bpm, 116)
  }

  func testWeirCloudMountainsDucksTree() {
    // плотина
    let br = G.river(G.bridgeT(len: 12))
    view.down(F(f1, (br.x, br.y)))
    view.move(F(f1, pp(5, 7)))
    XCTAssertEqual(kinds(), [A.len]); XCTAssertEqual(rec.acts[0].a, [6])
    view.up(F(f1, pp(5, 7)))
    rec.acts.removeAll()
    // облако
    let cl = G.cloud(cutoff: 0.62)
    view.down(F(f1, (cl.cx, cl.cy)))
    view.move(F(f1, (cl.cx, cl.cy - 60)))
    XCTAssertEqual(kinds(), [A.setfx]); XCTAssertEqual(rec.acts[0].i, 4)
    XCTAssertEqual(rec.acts[0].a[0], 0.62 + 60.0 / 220, accuracy: 1e-9)
    view.up(F(f1, (cl.cx, cl.cy - 60)))
    rec.acts.removeAll()
    // горы
    let m: P = (60, G.hor - 20)
    view.down(F(f1, m)); view.move(F(f1, off(m, 0, -60)))
    XCTAssertEqual(kinds(), [A.setfx]); XCTAssertEqual(rec.acts[0].i, 5)
    XCTAssertEqual(rec.acts[0].a[0], 0.25 + 60.0 / 160, accuracy: 1e-9)
    view.up(F(f1, off(m, 0, -60)))
    rec.acts.removeAll()
    // утки
    let d = G.ducks(att: 0.08, rel: 0.45, now: view.now)
    let da: P = (d.a.x, d.a.y - d.a.s * 0.35), dr: P = (d.r.x, d.r.y - d.r.s * 0.35)
    view.down(F(f1, da)); view.move(F(f1, off(da, 0, -50)))
    XCTAssertEqual(kinds(), [A.setfx]); XCTAssertEqual(rec.acts[0].i, 6)
    XCTAssertEqual(rec.acts[0].a[0], 0.08 + 50.0 / 160, accuracy: 1e-9)
    view.up(F(f1, off(da, 0, -50)))
    rec.acts.removeAll()
    view.down(F(f1, dr)); view.move(F(f1, off(dr, 0, -50)))
    XCTAssertEqual(kinds(), [A.setfx]); XCTAssertEqual(rec.acts[0].i, 7)
    XCTAssertEqual(rec.acts[0].a[0], 0.45 + 50.0 / 160, accuracy: 1e-9)
    view.up(F(f1, off(dr, 0, -50)))
    rec.acts.removeAll()
    // дерево
    let cr = G.crown()
    view.down(F(f1, (cr.x, cr.y)))
    view.move(F(f1, (cr.x + 26, cr.y)))
    XCTAssertEqual(kinds(), [A.shakeby]); XCTAssertEqual(rec.acts[0].a, [0.1])
    view.up(F(f1, (cr.x + 26, cr.y)))
  }

  func testBirdsLaser() {
    mirrorBuf = mirror(fx: [3: 0.8]); view.tick(now: 1.0, dt: 0.016)
    var bs: [(x: Double, y: Double, s: Double, i: Int, fast: Double)] = []
    G.birds(chorus: 0.8, now: view.now, birdsAt: -1e9, into: &bs)
    XCTAssertEqual(bs.count, 13)
    let cl = G.cloud(cutoff: 0.62), cr = G.crown()
    guard let b = bs.first(where: { hypot($0.x - cl.cx, $0.y - cl.cy) > 80 && hypot($0.x - cr.x, $0.y - cr.y) > 70 }) else { return XCTFail("нет птицы вне облака и дерева") }
    tap(f1, (b.x, b.y))
    XCTAssertEqual(kinds(), [A.laser])
    XCTAssertEqual(view.state.birdsAt, view.now)
    rec.acts.removeAll()
    view.down(F(f1, (b.x, b.y))); view.move(F(f1, (b.x + 20, b.y))); view.up(F(f1, (b.x + 20, b.y)))
    XCTAssertEqual(kinds(), [])                            // сдвинули — не тап
  }

  func testFrogCroak() {
    guard let fr = view.frogAt else { return XCTFail("лягушки нет") }
    XCTAssertEqual(fr.i, 0)
    tap(f1, (fr.x, fr.y))
    XCTAssertEqual(kinds(), [A.croak]); XCTAssertEqual(rec.acts[0].a, [Double(view.pad(fr.i).note)])
    XCTAssertEqual(view.state.croakAt, view.now)
    rec.acts.removeAll()
    view.down(F(f1, (fr.x, fr.y)))                         // сдвиг — это её кувшинка
    view.move(F(f1, pp(fr.i, 11)))
    view.up(F(f1, pp(fr.i, 11)))
    XCTAssertEqual(kinds(), [A.note, A.hear]); XCTAssertEqual(rec.acts[0].i, fr.i); XCTAssertEqual(rec.acts[0].a, [11])
  }

  func testSkiffOnRiver() {
    let h = G.skiffHome()
    XCTAssertEqual(view.skiff.x, h.x, accuracy: 1e-9); XCTAssertEqual(view.skiff.y, h.y, accuracy: 1e-9)
    view.down(F(f1, h))
    XCTAssertFalse(view.skiff.home); XCTAssertTrue(view.skiff.held)
    let w = pp(8, 3)
    view.move(F(f1, w))
    let o = G.onRiver(w.x, w.y)
    XCTAssertEqual(kinds(), [A.skiff]); XCTAssertEqual(rec.acts[0].i, 0)
    XCTAssertEqual(rec.acts[0].a.count, 3)
    XCTAssertEqual(rec.acts[0].a[0], o.q, accuracy: 1e-9); XCTAssertEqual(rec.acts[0].a[1], o.t, accuracy: 1e-9); XCTAssertEqual(rec.acts[0].a[2], 0)
    XCTAssertTrue(view.skiff.onRiver)
    XCTAssertFalse(view.skiff.label.isEmpty)
    rec.acts.removeAll()
    view.move(F(f1, h))                                    // назад на берег
    XCTAssertEqual(kinds(), [A.skiffOff]); XCTAssertFalse(view.skiff.onRiver)
    view.move(F(f1, off(h, 0, 10)))
    view.up(F(f1, off(h, 0, 10), t: 50))                   // медленно (истории свежей нет), вне пруда — домой
    XCTAssertNil(view.skiff.fly); XCTAssertNotNil(view.skiff.back)
    XCTAssertFalse(view.skiff.home)
    view.tick(now: 2.0, dt: 1.0)
    XCTAssertFalse(view.skiff.home)
    view.tick(now: 2.31, dt: 0.31)
    XCTAssertTrue(view.skiff.home); XCTAssertNil(view.skiff.back)
    XCTAssertEqual(view.skiff.x, h.x, accuracy: 1e-9)
  }

  func testSkiffDropInPond() {
    let s: P = (view.skiff.x, view.skiff.y), pd = G.pond()
    view.down(F(f1, s))
    view.move(F(f1, (pd.x, pd.y)))
    view.up(F(f1, (pd.x, pd.y), t: 60))                    // бросили прямо в заводь
    XCTAssertNotNil(view.skiff.fly)
    view.tick(now: 3.0, dt: 2.0)
    XCTAssertEqual(count(A.scare), 1)
  }

  func testSkiffThrow() {
    throwSkiff(f1, t: 10)
    XCTAssertNotNil(view.skiff.fly)
    let fl = view.skiff.fly!
    XCTAssertTrue(fl.dur > 0.12)
    XCTAssertEqual(count(A.scare), 0)
    view.tick(now: 1.0 + fl.dur / 2, dt: 0.1)
    XCTAssertEqual(count(A.scare), 0)
    XCTAssertFalse(view.state.envOpen(now: 1.0 + fl.dur / 2))
    view.tick(now: 1.0 + fl.dur + 0.01, dt: 0.1)
    XCTAssertEqual(count(A.scare), 1)
    XCTAssertTrue(view.state.envOpen(now: view.now))
    XCTAssertNil(view.skiff.fly); XCTAssertNotNil(view.splash); XCTAssertNotNil(view.skiff.back)
    view.tick(now: 1.0 + fl.dur + 0.1, dt: 0.1)
    XCTAssertEqual(count(A.scare), 1)                      // один раз
    // утки не ловят касание до 4 с
    rec.acts.removeAll()
    let d = G.ducks(att: 0.08, rel: 0.45, now: view.now)
    tap(f2, (d.a.x, d.a.y - d.a.s * 0.35))
    view.down(F(f2, (d.a.x, d.a.y - d.a.s * 0.35))); view.move(F(f2, (d.a.x, d.a.y - 90))); view.up(F(f2, (d.a.x, d.a.y - 90)))
    XCTAssertEqual(count(A.setfx), 0)
    view.tick(now: 1.0 + fl.dur + 4.2, dt: 0.1)            // вернулись
    let d2 = G.ducks(att: 0.08, rel: 0.45, now: view.now)
    view.down(F(f2, (d2.a.x, d2.a.y - d2.a.s * 0.35))); view.move(F(f2, (d2.a.x, d2.a.y - 90)))
    XCTAssertEqual(count(A.setfx), 1)
  }

  func testThrowWhileGone() {
    throwSkiff(f1, t: 10)
    view.tick(now: 2.0, dt: 1.0)
    XCTAssertEqual(count(A.scare), 1)
    view.tick(now: 4.0, dt: 2.0)                           // доплыл домой
    XCTAssertTrue(view.skiff.home)
    XCTAssertTrue(view.state.envOpen(now: 4.0))
    rec.acts.removeAll()
    throwSkiff(f1, t: 20)                                  // утки ещё не вернулись
    XCTAssertNil(view.skiff.fly)
    XCTAssertNotNil(view.skiff.back)
    view.tick(now: 5.6, dt: 1.6)
    XCTAssertEqual(count(A.scare), 0)
    XCTAssertTrue(view.skiff.home)
  }

  func testSkiffMenu() {
    openMenu(f1)
    XCTAssertNotNil(view.menu); XCTAssertTrue(view.menu!.held)
    let o = view.menuOpts()
    XCTAssertEqual(o.count, 5)
    for k in 0..<5 { XCTAssertEqual(view.menuHit(o[k].x, o[k].y), k) }
    XCTAssertEqual(view.menuHit(0, 0), -1)
    rec.acts.removeAll()
    view.move(F(f1, o[1]))
    XCTAssertEqual(view.menu!.hover, 1)
    view.up(F(f1, o[2]))                                   // отпустил над цветком 2
    XCTAssertTrue(rec.acts.contains { $0.kind == A.wave && $0.a == [2] })
    XCTAssertEqual(view.state.lastWave, 2); XCTAssertNil(view.menu); XCTAssertTrue(view.skiff.home)
    XCTAssertFalse(rec.acts.contains { $0.kind == A.plant || $0.kind == A.remove })
    // отпустил мимо — меню ждёт
    openMenu(f1)
    view.up(F(f1, (5, 5)))
    XCTAssertNotNil(view.menu); XCTAssertFalse(view.menu!.held)
    rec.acts.removeAll()
    view.down(F(f2, o[4])); view.up(F(f2, o[4]))           // тап по цветку 4
    XCTAssertEqual(kinds(), [A.wave]); XCTAssertEqual(rec.acts[0].a, [4])
    XCTAssertEqual(view.state.lastWave, 4); XCTAssertNil(view.menu)
    // тап мимо закрывает
    openMenu(f1); view.up(F(f1, (5, 5)))
    rec.acts.removeAll()
    view.down(F(f2, (5, 5))); view.up(F(f2, (5, 5)))
    XCTAssertNil(view.menu); XCTAssertEqual(kinds(), [])
  }

  func testMenuHoldNotOpenWhenMoved() {
    let h = G.skiffHome()
    view.down(F(f1, h)); view.move(F(f1, off(h, 12)))
    view.tick(now: 1.5, dt: 0.5)
    XCTAssertNil(view.menu)
  }

  func testTwoFingers() {
    view.down(F(f1, pp(0, 2))); view.down(F(f2, pp(8, 4)))
    view.move(F(f1, pp(0, 10))); view.move(F(f2, pp(8, 12)))
    XCTAssertEqual(kinds(), [A.note, A.hear, A.note, A.hear])
    XCTAssertEqual(rec.acts[0].i, 0); XCTAssertEqual(rec.acts[0].a, [10])
    XCTAssertEqual(rec.acts[2].i, 8); XCTAssertEqual(rec.acts[2].a, [12])
    view.up(F(f1, pp(0, 10))); view.up(F(f2, pp(8, 12)))
    XCTAssertEqual(rec.acts.count, 4)
  }

  func testRestoredMidGesture() {
    openMenu(f3)                                           // C: держит челнок — меню
    XCTAssertNotNil(view.menu)
    view.down(F(f1, pp(3, 5)))                             // A: палец на кувшинке
    view.down(F(f2, G.skiffHome()))                        // B: берёт челнок и ведёт на воду
    let w = pp(8, 3)
    view.move(F(f2, w))
    XCTAssertTrue(view.skiff.onRiver)
    rec.acts.removeAll()
    view.restored()
    XCTAssertEqual(count(A.skiffOff), 1)
    XCTAssertNil(view.menu); XCTAssertTrue(view.skiff.home); XCTAssertFalse(view.skiff.onRiver)
    XCTAssertNil(view.skiff.fly); XCTAssertNil(view.skiff.back); XCTAssertNil(view.wake)
    rec.acts.removeAll()
    view.move(F(f1, pp(3, 9))); view.move(F(f2, off(w, 30))); view.move(F(f3, (5, 5)))
    view.up(F(f1, pp(3, 9))); view.up(F(f2, off(w, 30))); view.up(F(f3, (5, 5)))
    XCTAssertEqual(kinds(), [])
    view.tick(now: 3.0, dt: 1.0)
    XCTAssertEqual(kinds(), [])
    XCTAssertTrue(opened.isEmpty)
  }

  func testRestoredNoSkiffOffOnShore() {
    view.down(F(f1, pp(3, 5)))
    rec.acts.removeAll()
    view.restored()
    XCTAssertEqual(kinds(), [])
  }

  func testCancel() {
    view.down(F(f1, G.skiffHome())); view.move(F(f1, pp(8, 3)))
    rec.acts.removeAll()
    view.cancel(F(f1, pp(8, 3)))
    XCTAssertEqual(kinds(), [A.skiffOff]); XCTAssertTrue(view.skiff.home); XCTAssertFalse(view.skiff.held)
    XCTAssertNil(view.skiff.fly)
    rec.acts.removeAll()
    view.down(F(f2, pp(3, 5)))
    view.cancel(F(f2, pp(3, 5)))
    XCTAssertEqual(kinds(), [])                            // без REMOVE
    view.up(F(f2, pp(3, 5)))
    XCTAssertEqual(kinds(), [])                            // палец забыт
    openMenu(f3)
    view.cancel(F(f3, G.skiffHome()))
    XCTAssertNil(view.menu)
  }

  func testIPadShift() {
    view.layout(W: 1024, H: 1366, topY: 24, safeBot: 20)
    view.tick(now: 1.1, dt: 0.1)
    XCTAssertGreaterThan(G.ox, 0)
    tap(f1, pp(1, 10))
    XCTAssertEqual(kinds(), [A.plant, A.hear]); XCTAssertEqual(rec.acts[0].a[0], 10)
  }
}
