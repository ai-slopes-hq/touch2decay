import XCTest
import CoreText
import T2DCore

private final class Rec: Core {
  var acts: [(kind: Int, i: Int)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) { acts.append((kind, i)) }
}

final class MeterTests: XCTestCase {
  private func stats(latN: Int32 = 5) -> t2d_app_stats_t {
    var s = t2d_app_stats_t()
    s.lat_avg = 0.004; s.lat_max = 0.006; s.lat_n = latN
    s.load_avg = 0.12; s.load_max = 0.21
    return s
  }

  func testLine() {
    let m = Meter()
    let l = m.line(stats: stats(), outLat: 0.005, frames: 256, sr: 48000, stars: 3)
    XCTAssertTrue(l.hasPrefix("lat 9.0/11.0 ms · load 12/21 % · "), l)
    XCTAssertTrue(l.hasSuffix("· miss 0 · buf 256@48000 · stars 3"), l)
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
    Stage(world: FirmamentumView(core: rec, geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34), readMirror: { [] }, readHeard: { [] }), audio: nil)
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
}
