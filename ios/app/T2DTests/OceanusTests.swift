import XCTest
import CoreText

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  var accept = true
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a, touchTime)); return accept }
}

final class OceanusTests: XCTestCase {
  private let geo = OceanGeo(W: 390, H: 844, topY: 59, safeBot: 34)
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private let f1 = NSObject(), f2 = NSObject()
  private lazy var view = OceanusView(core: rec, geo: geo, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  })

  typealias C = (id: Int, slot: Int, ang: Double, rn: Double, pinned: Bool)
  // зеркало: шапка 75 (fx 5, luna 4, moon, форма 64, число) и города по 10 чисел
  private func setMirror(cities: [C] = [], fx: [Double] = [0.45, 0.4, 0, 0.55, 0.4], luna: [Double] = [0.45, 0, 0, 0], moon: Double = 0, now: Double = 1) {
    var b = fx + luna + [moon] + [Double](repeating: 0, count: 64) + [Double(cities.count)]
    for c in cities { b += [Double(c.slot), Double(c.id), c.ang, c.rn, c.pinned ? 1 : 0, 0.8, 0, 0, 220, 0.3] }
    mirrorBuf = b; view.tick(now: now, dt: 0.016)
  }
  private func finger(_ o: NSObject, _ p: CGPoint, t0: Double = 0, now: Double = 0, p0: CGPoint? = nil) -> Finger {
    Finger(id: ObjectIdentifier(o), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: t0, moved: false, touchTime: now)
  }
  private func landPt(_ a: Double = 1, _ rn: CGFloat = 0.5) -> CGPoint { geo.at(a, rn * geo.Rd) }
  private var waterPt: CGPoint { geo.at(2.5, geo.Rr) }
  private var pinned4: [C] { (0..<4).map { (id: $0 + 1, slot: $0, ang: 0.4 + Double($0) * 1.4, rn: 0.7, pinned: true) } }

  func testParseMirror() {
    var b = [1, 2, 3, 4, 5.0, 6, 7, 8, 9, 0.25] + (0..<64).map { Double($0) / 64 } + [2]
    b += [0, 11, 1.5, 0.6, 1, 0.7, 1, 2, 330, 0.4] + [3, 12, 4, 0.2, 0, 0.8, -1, 0, 110, 0.1]
    let m = OceanMirror.parse(b[...])
    XCTAssertEqual(m.fx, [1, 2, 3, 4, 5]); XCTAssertEqual(m.luna, [6, 7, 8, 9]); XCTAssertEqual(m.moon, 0.25)
    XCTAssertEqual(m.shape.count, 64); XCTAssertEqual(m.shape[32], 0.5)
    XCTAssertEqual(m.cities.count, 2)
    let c = m.cities[0]
    XCTAssertEqual([c.slot, c.id], [0, 11]); XCTAssertEqual(c.ang, 1.5); XCTAssertEqual(c.rn, 0.6); XCTAssertTrue(c.pinned)
    XCTAssertEqual([c.lvl, c.oct, c.path, c.hz, c.gain], [0.7, 1, 2, 330, 0.4])
    XCTAssertFalse(m.cities[1].pinned); XCTAssertEqual(m.cities[1].oct, -1)
    XCTAssertTrue(OceanMirror.parse(b[0..<40]).cities.isEmpty)
    XCTAssertEqual(OceanMirror.parse(ArraySlice([Double]())).fx, [0, 0, 0, 0, 0])
  }

  func testTapLandAddsTemp() {
    setMirror(cities: [(id: 4, slot: 0, ang: 3, rn: 0.8, pinned: true), (id: 2, slot: 2, ang: 5, rn: 0.8, pinned: false)])
    view.down(finger(f1, landPt(), t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1)
    let a = rec.acts[0]
    XCTAssertEqual(a.kind, 0); XCTAssertEqual(a.a.count, 5)
    XCTAssertEqual(a.a[0], 1, accuracy: 1e-6); XCTAssertEqual(a.a[1], 0.5, accuracy: 1e-6)
    XCTAssertEqual(a.a[2], 0); XCTAssertEqual(a.a[3], 1, "слот — первый свободный"); XCTAssertEqual(a.a[4], 5, "max(зеркало 4, выданный 0) + 1")
    view.up(finger(f1, landPt(), t0: 5, now: 5.1))
    XCTAssertEqual(rec.acts.last?.kind, 1); XCTAssertEqual(rec.acts.last?.i, 5)
    view.down(finger(f1, landPt(), t0: 9, now: 9))        // после отпускания следующий id — больше
    XCTAssertEqual(rec.acts.last?.a[4], 6)
  }

  func testAllSixSlotsTakenSendsNothing() {
    setMirror(cities: (0..<6).map { (id: $0 + 1, slot: $0, ang: 0.3 + Double($0), rn: 0.9, pinned: $0 < 3) })
    view.down(finger(f1, landPt(0.0, 0.1), t0: 5, now: 5))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testDoubleTapPins() {
    setMirror()
    view.down(finger(f1, landPt(), t0: 5, now: 5)); view.up(finger(f1, landPt(), t0: 5, now: 5.05))
    rec.acts.removeAll()
    view.down(finger(f1, landPt(1, 0.52), t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 0); XCTAssertEqual(rec.acts[0].a[2], 1)
    view.up(finger(f1, landPt(), t0: 5.2, now: 5.25))
    XCTAssertEqual(rec.acts.count, 1, "оставленный при подъёме не отпускается")
  }

  func testDoubleTapUnpins() {
    setMirror(cities: [(id: 3, slot: 0, ang: 1, rn: 0.5, pinned: true)])
    view.down(finger(f1, landPt(), t0: 5, now: 5)); view.up(finger(f1, landPt(), t0: 5, now: 5.05))
    XCTAssertTrue(rec.acts.isEmpty)
    view.down(finger(f1, landPt(), t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 1); XCTAssertEqual(rec.acts[0].i, 3)
  }

  func testPinMax() {
    setMirror(cities: pinned4)
    let p = landPt(0.1, 0.2)
    view.down(finger(f1, p, t0: 5, now: 5)); view.up(finger(f1, p, t0: 5, now: 5.05))
    rec.acts.removeAll()
    view.down(finger(f1, p, t0: 5.2, now: 5.2))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 0)
    XCTAssertEqual(rec.acts[0].a[2], 0, "пятый оставленный — временный")
  }

  func testDragCityMoves() {
    setMirror(cities: [(id: 3, slot: 0, ang: 1, rn: 0.5, pinned: true)])
    view.down(finger(f1, landPt(), t0: 5, now: 5))
    var m = finger(f1, landPt(2, 0.7), t0: 5, now: 5.1, p0: landPt()); m.moved = true
    view.move(m)
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 2); XCTAssertEqual(rec.acts[0].i, 3)
    XCTAssertEqual(rec.acts[0].a[0], 2, accuracy: 1e-6); XCTAssertEqual(rec.acts[0].a[1], 0.7, accuracy: 1e-6)
    XCTAssertEqual(view.mirror.cities[0].ang, 2, accuracy: 1e-6, "правленный — по-своему, пока зеркало не догнало")
  }

  func testWaterPushRelease() {
    setMirror()
    view.down(finger(f1, waterPt, t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 6); XCTAssertEqual(rec.acts[0].a.count, 3)
    let fid = rec.acts[0].a[0]
    XCTAssertEqual(rec.acts[0].a[1], 2.5 / (2 * .pi), accuracy: 1e-6); XCTAssertEqual(rec.acts[0].a[2], 0, accuracy: 1e-6)
    var m = finger(f1, geo.at(2.6, geo.Rr + 10), t0: 5, now: 5.5, p0: waterPt); m.moved = true
    view.move(m)
    XCTAssertEqual(rec.acts.count, 2); XCTAssertEqual(rec.acts[1].kind, 6); XCTAssertEqual(rec.acts[1].a[0], fid)
    view.up(m)
    XCTAssertEqual(rec.acts.last?.kind, 7); XCTAssertEqual(rec.acts.last?.a, [fid])
    XCTAssertEqual(rec.acts.filter { $0.kind == 8 }.count, 0, "протянул — без всплеска")
  }

  func testQuickTapSplashes() {
    setMirror()
    let out = geo.at(2.5, geo.Rr + 6)                      // снаружи кольца — +0.35
    view.down(finger(f1, out, t0: 5, now: 5))
    view.up(finger(f1, out, t0: 5, now: 5.1))
    XCTAssertEqual(rec.acts.map(\.kind), [6, 7, 8])
    XCTAssertEqual(rec.acts[2].a[0], 2.5 / (2 * .pi), accuracy: 1e-6); XCTAssertEqual(rec.acts[2].a[1], 0.35, accuracy: 1e-9)
    XCTAssertEqual(view.ui.ripples.count, 1)
    view.down(finger(f1, waterPt, t0: 6, now: 6)); view.up(finger(f1, waterPt, t0: 6, now: 6.5))   // долго — не всплеск
    XCTAssertEqual(rec.acts.filter { $0.kind == 8 }.count, 1)
  }

  func testPushAndTapTwoFingers() {
    setMirror()
    view.down(finger(f1, waterPt, t0: 5, now: 5))
    let fid = rec.acts[0].a[0]
    view.down(finger(f2, landPt(), t0: 5.1, now: 5.1))
    XCTAssertEqual(rec.acts[1].kind, 0)
    view.up(finger(f2, landPt(), t0: 5.1, now: 5.3))      // город: DROP, не RELEASE
    XCTAssertEqual(rec.acts[2].kind, 1)
    XCTAssertEqual(rec.acts.filter { $0.kind == 7 }.count, 0, "вода ещё держится")
    view.up(finger(f1, waterPt, t0: 5, now: 5.6))
    XCTAssertEqual(rec.acts.last?.kind, 7); XCTAssertEqual(rec.acts.last?.a, [fid])
    XCTAssertEqual(rec.acts.filter { $0.kind == 0 }.count, 1, "вода не получает ADD")
    XCTAssertEqual(rec.acts.filter { $0.kind == 6 }.map { $0.a[0] }, [fid])
  }

  func testDroppedHiddenUntilMirror() {
    setMirror(cities: [(id: 5, slot: 0, ang: 1, rn: 0.5, pinned: true)])
    view.down(finger(f1, landPt(), t0: 5, now: 5)); view.up(finger(f1, landPt(), t0: 5, now: 5.05))
    view.down(finger(f1, landPt(), t0: 5.2, now: 5.2)); view.up(finger(f1, landPt(), t0: 5.2, now: 5.25))
    XCTAssertEqual(rec.acts.last?.kind, 1); XCTAssertEqual(rec.acts.last?.i, 5)
    XCTAssertTrue(view.mirror.cities.isEmpty, "убран здесь — скрыт, зеркало ещё старое")
    view.tick(now: 5.3, dt: 0.016)
    XCTAssertTrue(view.mirror.cities.isEmpty)
    rec.acts.removeAll()
    view.down(finger(f1, landPt(), t0: 6, now: 6))        // по этому месту — новый временный, не убранный
    XCTAssertEqual(rec.acts[0].kind, 0); XCTAssertGreaterThan(rec.acts[0].a[4], 5)
    view.up(finger(f1, landPt(), t0: 6, now: 6.1))
    setMirror(cities: [], now: 7)
    XCTAssertTrue(view.mirror.cities.isEmpty)
    setMirror(cities: [(id: 5, slot: 0, ang: 1, rn: 0.5, pinned: true)], now: 8)   // зеркало без него было — запись снята
    XCTAssertEqual(view.mirror.cities.count, 1)
  }

  func testMoonHoldOpensLuna() {
    var opened: [SheetSpec] = []
    view.openSheet = { opened.append($0) }
    setMirror(cities: [(id: 3, slot: 0, ang: 1, rn: 0.5, pinned: true), (id: 4, slot: 1, ang: 3, rn: 0.5, pinned: false)], moon: 0.3)
    let mp = geo.moonPos(0.3)
    view.tick(now: 10, dt: 0.016)
    view.down(finger(f1, mp, t0: 10, now: 10))
    view.tick(now: 10.2, dt: 0.016); XCTAssertEqual(opened.count, 0)
    view.tick(now: 10 + Touch.holdMs * 0.6 / 1000 + 0.02, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(opened[0].title, "luna")
    view.tick(now: 11, dt: 0.016); XCTAssertEqual(opened.count, 1, "плашка один раз")
    view.up(finger(f1, mp, t0: 10, now: 11))
    opened.removeAll()
    view.tick(now: 20, dt: 0.016)
    view.down(finger(f1, landPt(), t0: 20, now: 20))      // оставленный
    view.tick(now: 20.3, dt: 0.016); XCTAssertEqual(opened.count, 0)
    view.tick(now: 20.45, dt: 0.016)
    XCTAssertEqual(opened.count, 1); XCTAssertEqual(opened[0].title, "civitas")
    view.up(finger(f1, landPt(), t0: 20, now: 21))
    let tp = geo.at(3, 0.5 * geo.Rd)                      // временный — плашки нет
    view.tick(now: 30, dt: 0.016); opened.removeAll()
    view.down(finger(f1, tp, t0: 30, now: 30))
    view.tick(now: 31, dt: 0.016)
    XCTAssertEqual(opened.count, 0)
  }

  func testSheetClosesWhenCityGone() {
    var gone: [Int] = []
    view.objGone = { gone.append($0) }
    setMirror(cities: [(id: 3, slot: 0, ang: 1, rn: 0.5, pinned: true)])
    let sp = view.citySpec(3)
    sp.set("lvl", 0.4)
    XCTAssertEqual(rec.acts.last?.kind, 3)
    setMirror(cities: [], now: 2)
    XCTAssertEqual(gone, [3])
    rec.acts.removeAll()
    sp.set("lvl", 0.9)
    XCTAssertTrue(rec.acts.isEmpty, "правки в чужой id не уходят")
  }

  func testLunaRows() {
    setMirror(luna: [0.45, 0, 0.2, 1])
    let sp = view.lunaSpec()
    XCTAssertEqual(sp.rows.map(\.key), ["orbit", "storm", "pull", "sway", "to"])
    sp.set("storm", 0.6); XCTAssertEqual(rec.acts.last!.kind, 5); XCTAssertEqual(rec.acts.last!.i, 1); XCTAssertEqual(rec.acts.last!.a, [1])
    sp.set("storm", 0.4); XCTAssertEqual(rec.acts.last!.a, [0])
    sp.set("to", 0.0); XCTAssertEqual(rec.acts.last!.i, 3); XCTAssertEqual(rec.acts.last!.a, [0])
    sp.set("to", 0.5); XCTAssertEqual(rec.acts.last!.a, [1])
    sp.set("to", 0.99); XCTAssertEqual(rec.acts.last!.a, [2])
    sp.set("to", 1.0); XCTAssertEqual(rec.acts.last!.a, [2])
    sp.set("pull", 0.7); XCTAssertEqual(rec.acts.last!.kind, 4); XCTAssertEqual(rec.acts.last!.i, 3); XCTAssertEqual(rec.acts.last!.a, [0.7])
    sp.set("orbit", 0.3); XCTAssertEqual(rec.acts.last!.kind, 5); XCTAssertEqual(rec.acts.last!.i, 0)
    sp.set("sway", 0.2); XCTAssertEqual(rec.acts.last!.i, 2)
    XCTAssertEqual(sp.get("to"), 0.5, accuracy: 1e-9); XCTAssertEqual(sp.get("pull"), 0.55, accuracy: 1e-9)
    XCTAssertEqual(sp.text("to"), "pitch"); XCTAssertEqual(sp.text("storm"), "sine")
    XCTAssertNil(sp.lfo)
  }

  func testCityRows() {
    setMirror(cities: [(id: 8, slot: 2, ang: 1, rn: 0.5, pinned: true)])
    let sp = view.citySpec(8)
    XCTAssertEqual(sp.rows.map(\.key), ["lvl", "oct", "path"])
    sp.set("lvl", 0.5); XCTAssertEqual(rec.acts.last!.kind, 3); XCTAssertEqual(rec.acts.last!.i, 8); XCTAssertEqual(rec.acts.last!.a, [0, 0.5])
    sp.set("oct", 0.0); XCTAssertEqual(rec.acts.last!.a, [1, -1])
    sp.set("oct", 0.5); XCTAssertEqual(rec.acts.last!.a, [1, 0])
    sp.set("oct", 1.0); XCTAssertEqual(rec.acts.last!.a, [1, 1])
    sp.set("path", 0.5); XCTAssertEqual(rec.acts.last!.a, [2, 1])
    sp.set("path", 1.0); XCTAssertEqual(rec.acts.last!.a, [2, 2])
    XCTAssertEqual(sp.text("path"), "pendulum"); XCTAssertEqual(sp.text("oct"), "octave +1")
    XCTAssertEqual(sp.get("oct"), 1, accuracy: 1e-9)
    XCTAssertNil(sp.lfo)
  }

  func testFanCodes() {
    setMirror(fx: [0.1, 0.2, 0.3, 0.4, 0.5])              // порядок ядра: tension, damping, wind, tide, hall
    let sp = view.fxSpec
    XCTAssertEqual(sp.rows.map(\.key), ["tension", "damping", "tide", "wind", "hall"])
    XCTAssertEqual(sp.rows.map(\.code), [4, 5, 7, 6, 8])
    XCTAssertEqual(sp.lfo?.obj, -1); XCTAssertEqual(sp.lfo?.keys, ["tension", "damping", "tide", "wind", "hall"]); XCTAssertEqual(sp.lfo?.shape, 0)
    sp.set("wind", 0.6); XCTAssertEqual(rec.acts.last!.kind, 4); XCTAssertEqual(rec.acts.last!.i, 2); XCTAssertEqual(rec.acts.last!.a, [0.6])
    sp.set("tide", 0.7); XCTAssertEqual(rec.acts.last!.i, 3)
    sp.set("hall", 0.2); XCTAssertEqual(rec.acts.last!.i, 4)
    sp.set("tension", 0.2); XCTAssertEqual(rec.acts.last!.i, 0)
    XCTAssertEqual(sp.get("tide"), 0.4); XCTAssertEqual(sp.get("wind"), 0.3); XCTAssertEqual(sp.arc?(), 0.5)
    XCTAssertEqual(sp.text("hall"), "50%")
  }

  func testEnterWakes() {
    view.enter(); view.dice(); view.clear()
    XCTAssertEqual(rec.acts.map(\.kind), [11, 10, 9])
  }

  func testCornerHit() {
    XCTAssertTrue(view.cornerHit(10, geo.sun.y + 10))
    XCTAssertFalse(view.cornerHit(200, 400))
    XCTAssertFalse(view.cornerHit(10, geo.sun.y - 1))
  }
}
