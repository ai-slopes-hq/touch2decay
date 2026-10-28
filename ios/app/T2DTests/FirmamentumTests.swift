import XCTest
import CoreText
import T2DCore

private final class Rec: Core {
  var acts: [(kind: Int, i: Int, a: [Double], t: Double)] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) { acts.append((kind, i, a, touchTime)) }
}

final class FirmamentumTests: XCTestCase {
  override class func setUp() {                         // шрифты — в бандле тестов (см. DrawTests)
    let urls = Bundle(for: FirmamentumTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }
  private let geo = Geo(W: 390, H: 844, topY: 59, safeBot: 34)
  private let rec = Rec()
  private var mirrorBuf: [Double] = []
  private lazy var view = FirmamentumView(core: rec, geo: geo, readMirror: { self.mirrorBuf }, readHeard: { [] })

  // зеркало с звёздами (id, h, u)
  private func setStars(_ s: [(Int, Double, Double)]) {
    var b = [Double](repeating: 0, count: 17); b[16] = Double(s.count)
    for (k, e) in s.enumerated() { b += [Double(k), Double(e.0), e.1, e.2, 1, 0.5, 0.5, 0.5, 0, 0, 1, 1, 0, 0] }
    mirrorBuf = b; view.tick(now: 1, dt: 0.016)
  }
  private func finger(_ p: CGPoint, t0: Double = 0, now: Double = 0, p0: CGPoint? = nil) -> Finger {
    Finger(id: ObjectIdentifier(self), x: p.x, y: p.y, x0: (p0 ?? p).x, y0: (p0 ?? p).y, t0: t0, moved: false, touchTime: now)
  }
  private var skyPt: CGPoint { geo.fromSky(h: 0.5, u: 0.2) }

  func testSkyRoundTrip() {
    // у самого верха свода крайние u уже вне купола (e > .97, как в вебе) — там toSky = nil; сетка — только внутри
    for hi in stride(from: 5, through: 95, by: 10) { for ui in stride(from: -95, through: 95, by: 10) {
      let h = Double(hi) / 100, u = Double(ui) / 100
      if hi > 75 && abs(ui) > 45 { continue }
      let q = geo.toSky(geo.fromSky(h: h, u: u))
      XCTAssertEqual(q?.h ?? -9, h, accuracy: 1e-6); XCTAssertEqual(q?.u ?? -9, u, accuracy: 1e-6)
    } }
    XCTAssertNil(geo.toSky(CGPoint(x: geo.cx, y: geo.hy + 10)))
  }

  func testMirrorParse() {
    t2d_app_init(48000, 1, 1e9, 1 << 10)
    var a = [0.4, 0.25, -1, 7]
    XCTAssertEqual(t2d_app_action(10, 0, 0, &a, 4, 0), 1)
    var l = [Float](repeating: 0, count: 256), r = l
    for _ in 0..<4 { t2d_app_render(&l, &r, 256, 0) }
    var m = [Double](repeating: 0, count: 1024)
    let n = Int(t2d_app_mirror(10, &m, 1024))
    let fm = FirmMirror.parse(Array(m[0..<n]))
    XCTAssertEqual(fm.stars.count, 1)
    XCTAssertEqual(fm.stars[0].id, 7); XCTAssertEqual(fm.stars[0].h, 0.4, accuracy: 1e-9); XCTAssertEqual(fm.stars[0].u, 0.25, accuracy: 1e-9)
  }

  func testHeardParse() {
    let h = Heard.parse([1, 10, 1, 0.3, 0.5, 0])
    XCTAssertEqual(h.count, 1)
    XCTAssertEqual(h[0].pulsed, [10]); XCTAssertEqual(h[0].dust.count, 1)
    XCTAssertEqual(h[0].dust[0].pan, 0.3); XCTAssertEqual(h[0].dust[0].a, 0.5); XCTAssertEqual(h[0].bolts, [])
  }

  func testTapAddsStar() {
    setStars([])
    view.down(finger(skyPt, t0: 5, now: 5))
    XCTAssertEqual(rec.acts.count, 1)
    XCTAssertEqual(rec.acts[0].kind, 0); XCTAssertEqual(rec.acts[0].t, 5)
    XCTAssertEqual(rec.acts[0].a[0], 0.5, accuracy: 1e-6); XCTAssertEqual(rec.acts[0].a[2], -1); XCTAssertEqual(rec.acts[0].a[3], 1)
  }

  func testDragMoves() {
    setStars([(3, 0.5, 0.2)])
    let p = skyPt
    view.down(finger(p)); view.move(finger(CGPoint(x: p.x + 7, y: p.y), p0: p))
    XCTAssertTrue(rec.acts.isEmpty)
    view.move(finger(CGPoint(x: p.x + 9, y: p.y), p0: p))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 2); XCTAssertEqual(rec.acts[0].i, 3)
  }

  func testQuickTapCloses() {
    setStars([(3, 0.5, 0.2)])
    view.down(finger(skyPt, t0: 10, now: 10)); view.up(finger(skyPt, t0: 10, now: 10.2))
    XCTAssertEqual(rec.acts.count, 1); XCTAssertEqual(rec.acts[0].kind, 1); XCTAssertEqual(rec.acts[0].i, 3)
    rec.acts = []
    view.down(finger(skyPt, t0: 10, now: 10)); view.up(finger(skyPt, t0: 10, now: 10.35))
    XCTAssertTrue(rec.acts.isEmpty)
    setStars([])
    view.down(finger(skyPt, t0: 20, now: 20)); view.up(finger(skyPt, t0: 20, now: 20.1))   // свежая
    XCTAssertEqual(rec.acts.map(\.kind), [0])
  }

  func testTouchOnVanishedStar() {
    setStars([(3, 0.5, 0.2)])
    let p = skyPt
    view.down(finger(p)); setStars([])
    view.move(finger(CGPoint(x: p.x + 30, y: p.y), p0: p)); view.up(finger(CGPoint(x: p.x + 30, y: p.y), now: 0.1, p0: p))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  func testSkyTapWhenFull() {
    setStars((1...6).map { ($0, 0.1 + 0.02 * Double($0), -0.9) })
    let p = skyPt
    view.down(finger(p)); view.move(finger(CGPoint(x: p.x + 30, y: p.y), p0: p)); view.up(finger(p, now: 0.1))
    XCTAssertTrue(rec.acts.isEmpty)
  }

  // ---------- рисование ----------
  private func ctx(_ w: Int, _ h: Int, scale: CGFloat = 2) -> Draw {
    let g = CGContext(data: nil, width: Int(CGFloat(w) * scale), height: Int(CGFloat(h) * scale), bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
    g.translateBy(x: 0, y: CGFloat(h) * scale); g.scaleBy(x: scale, y: -scale)   // начало слева сверху, как в UIKit
    let d = Draw(g: g, W: CGFloat(w), H: CGFloat(h)); d.setTheme(view.theme); return d
  }

  func testWallCachedOnce() {
    let d = ctx(390, 844)
    XCTAssertEqual(view.wallBuilds, 0)
    view.draw(d, now: 1); view.draw(d, now: 1.016)
    XCTAssertEqual(view.wallBuilds, 1)
    view.geo = Geo(W: 360, H: 780, topY: 59, safeBot: 34)
    let d2 = ctx(360, 780)
    view.draw(d2, now: 2); view.draw(d2, now: 2.016)
    XCTAssertEqual(view.wallBuilds, 2)
  }

  // кадр с 6 звёздами, кометой, 60 искрами и 12 молниями; время — для ориентира, не порог
  func testDrawSmoke() {
    var b = [Double](repeating: 0, count: 17)
    b[0] = 10; b[1] = 1; b[2] = 1; b[3] = 0.3; b[4] = -0.6; b[5] = 0.7; b[6] = 0.5; b[7] = 9; b[8] = 4; b[16] = 6
    for k in 0..<6 { b += [Double(k), Double(k + 1), 0.1 + 0.14 * Double(k), -0.7 + 0.28 * Double(k), 3, 0.2 * Double(k % 4), k % 2 == 0 ? 0.3 : 0, 0.8, 0, 1, k < 2 ? 2.5 : 220, 800, 0.4, 5] }
    mirrorBuf = b; view.tick(now: 10, dt: 0.016)
    XCTAssertEqual(view.mirror.stars.count, 6)
    view.hear(Heard(pulsed: [0, 1, 2], dust: (0..<60).map { (pan: Double($0 % 20) / 10 - 1, a: 0.3) }, bolts: Array(0..<6) + Array(0..<6)), now: 10)
    XCTAssertEqual(view.specks.count, 60); XCTAssertEqual(view.bolts.count, 12)
    let d = ctx(390, 844)
    view.draw(d, now: 10.01)                            // прогрев: фон строится один раз
    measure { for _ in 0..<10 { view.draw(d, now: 10.02) } }   // среднее на 10 кадров — делим на 10
    XCTAssertNotNil(d.g.makeImage())
  }
}
