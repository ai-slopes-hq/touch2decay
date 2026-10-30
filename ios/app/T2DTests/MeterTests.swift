import XCTest
import CoreText
import T2DCore

private final class Rec: Core {
  var acts: [(kind: Int, i: Int)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i)); return true }
}

private final class NullHostCore: HostCore {
  func vol(_ gain: Double) -> Bool { true }
  func scale(_ s: Scl) -> Bool { true }
  func snap(slot: Int, id: Int) -> Bool { true }
  func restore(slot: Int, _ w: String) -> Bool { true }
  func takeSnap() -> (id: Int, slot: Int, w: String)? { nil }
  func lfoAdd(slot: Int, obj: Int, key: Int, base: Double, shape: Int) -> Bool { true }
  func lfoSpec(slot: Int, obj: Int, key: Int, morph: Double, rate: Double, depth: Double) -> Bool { true }
  func lfoBase(slot: Int, obj: Int, key: Int, base: Double) -> Bool { true }
  func lfoOff(slot: Int, obj: Int, key: Int) -> Bool { true }
  func lfoDrop(slot: Int, obj: Int) -> Bool { true }
  func lfoSnap() -> [LfoSnap] { [] }
  func lfoSample(shape: Int, morph: Double, u: Double, seed: Int) -> Double { 0 }
}

final class MeterTests: XCTestCase {
  private func stats(latN: Int32 = 5) -> t2d_app_stats_t {
    var s = t2d_app_stats_t()
    s.lat_avg = 0.004; s.lat_max = 0.006; s.lat_n = latN
    s.load_avg = 0.12; s.load_max = 0.21
    s.snap_avg = 0.0004; s.snap_max = 0.0012; s.snap_n = 2; s.snap_lost = 1
    return s
  }

  func testLine() {
    let m = Meter()
    let l = m.line(stats: stats(), outLat: 0.005, frames: 256, sr: 48000, stars: 3)
    XCTAssertTrue(l.hasPrefix("lat 9.0/11.0 ms · load 12/21 % · "), l)
    XCTAssertTrue(l.hasSuffix("· miss 0 · buf 256@48000 · stars 3"), l)
  }

  func testSnapAndBuild() {
    let l = Meter().line(stats: stats(), outLat: 0, frames: 256, sr: 48000, stars: 0)
    XCTAssertTrue(l.contains("snap 0.40/1.20 ms, lost 1"), l)
    var s = stats(); s.snap_n = 0
    XCTAssertTrue(Meter().line(stats: s, outLat: 0, frames: 256, sr: 48000, stars: 0).contains("snap –, lost 1"))
    XCTAssertEqual(Meter.buildLabel(["CFBundleShortVersionString": "1.2"]), "v1.2")
    XCTAssertEqual(Meter.buildLabel(["CFBundleShortVersionString": "1.2", "T2DBuildHash": "abc"]), "v1.2 · abc")
  }

  func testNoLatency() {
    let l = Meter().line(stats: stats(latN: 0), outLat: 0.005, frames: 256, sr: 48000, stars: 0)
    XCTAssertTrue(l.hasPrefix("lat – · load 12/21 % · "), l)
  }

  func testMissedFrames() {
    let m = Meter()
    var t = 0.0
    for dt in [0.0167, 0.040, 0.0167] { t += dt; m.frame(start: t, end: t + 0.004, missed: 0) }
    XCTAssertTrue(m.line(stats: stats(), outLat: 0, frames: 256, sr: 48000, stars: 0).contains("miss 1"))
    XCTAssertTrue(m.line(stats: stats(), outLat: 0, frames: 256, sr: 48000, stars: 0).contains("miss 0"), "окно сбрасывается")
  }

  func testFrameTimes() {
    let m = Meter()
    m.frame(start: 0, end: 0.004, missed: 0); m.frame(start: 0.0167, end: 0.0167 + 0.008, missed: 0)
    XCTAssertTrue(m.line(stats: stats(), outLat: 0, frames: 256, sr: 48000, stars: 0).contains("frame 6.0/8.0 ms"))
  }

  // ---------- угол ----------
  override class func setUp() {
    let urls = Bundle(for: MeterTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }
  private let rec = Rec()
  private func stage() -> Stage {
    stage(FirmamentumView(core: rec, geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34), readMirror: { _ in 0 }, readHeard: { _ in 0 }))
  }
  private func stage(_ w: FirmamentumView) -> Stage {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("meter-\(UUID().uuidString)")
    return Stage(world: w, host: Host(world: w, core: NullHostCore(), store: Store(dir: dir, log: { _ in })), audio: nil)
  }
  private func finger(_ x: CGFloat, _ y: CGFloat, t0: Double, now: Double, id: AnyObject) -> Finger {
    Finger(id: ObjectIdentifier(id), x: x, y: y, x0: x, y0: y, t0: t0, moved: false, touchTime: now)
  }

  func testCornerHoldToggles() {
    let s = stage(), a = NSObject(), b = NSObject()
    XCTAssertFalse(s.meter.visible)
    s.touchDown(finger(380, 830, t0: 10, now: 10, id: a)); s.touchUp(finger(380, 830, t0: 10, now: 10.45, id: a))
    XCTAssertTrue(s.meter.visible)
    s.touchDown(finger(380, 830, t0: 20, now: 20, id: b)); s.touchUp(finger(380, 830, t0: 20, now: 20.30, id: b))
    XCTAssertTrue(s.meter.visible, "300 мс — без переключения")
    XCTAssertTrue(rec.acts.isEmpty, "касание в углу миру не идёт")
    let c = NSObject()
    s.touchDown(finger(195, 400, t0: 30, now: 30, id: c))
    XCTAssertFalse(rec.acts.isEmpty, "контроль: вне угла мир получает касание")
  }

  // отмена системой: угол не переключает панель, мир не закрывает звезду
  func testCancelledCornerHoldDoesNotToggle() {
    let s = stage(), a = NSObject()
    s.touchDown(finger(380, 830, t0: 10, now: 10, id: a)); s.touchCancel(finger(380, 830, t0: 10, now: 10.6, id: a))
    XCTAssertFalse(s.meter.visible)
  }

  // палец из угла, ушедший дальше holdMove, съеден до подъёма: миру ни down, ни move, ни up
  func testCornerFingerStaysConsumedAfterMove() {
    let s = stage(), a = NSObject()
    s.touchDown(finger(380, 830, t0: 10, now: 10, id: a))
    var f = finger(380, 780, t0: 10, now: 10.1, id: a); f.x0 = 380; f.y0 = 830
    s.touchMove(f); s.touchMove(f); s.touchUp(f)
    XCTAssertTrue(rec.acts.isEmpty)
    XCTAssertFalse(s.meter.visible)
  }

  func testCancelledShortPressDoesNotCloseStar() {
    var b = [Double](repeating: 0, count: 17); b[16] = 1
    b += [0, 3, 0.5, 0.2, 1, 0.5, 0.5, 0.5, 0, 0, 1, 1, 0, 0]
    let w = FirmamentumView(core: rec, geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34), readMirror: { m in m.replaceSubrange(0..<b.count, with: b); return b.count }, readHeard: { _ in 0 })
    let s = stage(w)
    w.tick(now: 1, dt: 0.016)
    let p = w.geo.fromSky(h: 0.5, u: 0.2), t = NSObject()
    s.touchDown(finger(p.x, p.y, t0: 10, now: 10, id: t)); s.touchCancel(finger(p.x, p.y, t0: 10, now: 10.1, id: t))
    XCTAssertTrue(rec.acts.isEmpty, "отменённый короткий тап не закрывает звезду")
    s.touchUp(finger(p.x, p.y, t0: 10, now: 10.1, id: t))   // после отмены подъём ничего не находит
    XCTAssertTrue(rec.acts.isEmpty)
  }
}
