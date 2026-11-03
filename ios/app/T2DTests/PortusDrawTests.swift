import XCTest
@testable import T2D

private final class RecD: Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true }
}

// картинка мира: луна, вехи, кораблики, буй, туман, маяк (view.js:199-324)
final class PortusDrawTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: PortusDrawTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  private let rec = RecD()
  private var mirrorBuf: [Double] = []
  private lazy var view = PortusView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, rng: { 0.5 })
  private let size = CGSize(width: 390, height: 844)
  private let bg: RGB = (6, 9, 13)

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    mirrorBuf = mirror()
    view.tick(now: 1.0, dt: 0.016)
  }

  // зеркало с умолчаниями PorMirror; on — места с корабликами
  private func mirror(on: [Int] = [], playing: Bool = false, step: Int = 0, cut: Double = 0.42, res: Double = 0.35,
                      fog: Double = 0.45, fx: Double = 0.25) -> [Double] {
    let m = PorMirror()
    var b = [Double](repeating: 0, count: Por.mirrorN)
    b[0] = playing ? Double(step) : -1; b[1] = playing ? 1 : 0; b[3] = m.bpm
    b[4] = cut; b[5] = res; b[6] = m.luna[2]
    for k in 0..<3 { b[7 + k] = m.echo[k] }
    b[10] = m.buoy.u; b[11] = m.buoy.d
    b[12] = fog; b[13] = m.fog[1]
    for k in 0..<5 { b[14 + k] = m.pharos[k]; b[19 + k] = fx }
    for j in on { let o = Por.head + j * Por.isleN; b[o] = 1; b[o + 1] = Double(j); b[o + 3] = 1 }
    return b
  }
  private func tick(_ b: [Double], now: Double = 1.1) { mirrorBuf = b; view.tick(now: now, dt: 0.1) }

  private func shot(size: CGSize? = nil, _ draw: (NatPen, Draw) -> Void) -> CGImage {
    let size = size ?? self.size
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    return UIGraphicsImageRenderer(size: size, format: f).image { r in
      let p = NatPen(g: r.cgContext, inkC: view.theme.ink, papC: view.theme.paper)
      p.fill(bg, 1); p.fillRect(0, 0, Double(size.width), Double(size.height))
      let d = Draw(g: r.cgContext, W: size.width, H: size.height)
      d.setTheme(view.theme)
      draw(p, d)
    }.cgImage!
  }
  private func rgba(_ img: CGImage) -> [UInt8] {
    var px = [UInt8](repeating: 0, count: img.width * img.height * 4)
    let c = CGContext(data: &px, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    return px
  }
  // центр масс света по строкам полосы
  private func lightCentroidY(_ img: CGImage, in r: CGRect) -> Double {
    var s = 0.0, n = 0.0
    var y = r.minY
    while y < r.maxY {
      let c = Double(litPixels(img, in: CGRect(x: r.minX, y: y, width: r.width, height: 1), bg: bg)); s += c * y; n += c; y += 1
    }
    return n > 0 ? s / n : -1
  }
  // медиана каналов по диску луны
  private func moonMedian(_ img: CGImage) -> (r: Int, g: Int, b: Int) {
    let M = view.geo.moon, px = rgba(img)
    var ch: [[Int]] = [[], [], []]
    for y in Int(M.y - M.r * 0.9)...Int(M.y + M.r * 0.9) { for x in Int(max(0, M.x - M.r * 0.9))...Int(M.x + M.r * 0.9) {
      if hypot(Double(x) - M.x, Double(y) - M.y) > M.r * 0.9 { continue }
      for k in 0..<3 { ch[k].append(Int(px[(y * img.width + x) * 4 + k])) }
    } }
    return (ch[0].sorted()[ch[0].count / 2], ch[1].sorted()[ch[1].count / 2], ch[2].sorted()[ch[2].count / 2])
  }
  private func gold(_ img: CGImage, over: Int) -> Int {
    let px = rgba(img)
    var n = 0
    for i in stride(from: 0, to: px.count, by: 4) where Int(px[i]) - Int(px[i + 2]) > over { n += 1 }
    return n
  }

  func testMoonFollowsCut() {
    func cy(_ cut: Double) -> Double {
      tick(mirror(cut: cut))
      let M = view.geo.moon
      return lightCentroidY(shot { p, d in view.drawMoon(p, d, nowMs: 1100, sun: true) }, in: CGRect(x: M.x - M.r * 3, y: 0, width: M.r * 6, height: view.geo.hor))
    }
    let lo = cy(0.1), hi = cy(0.9)
    XCTAssertGreaterThan(lo, 0)
    XCTAssertGreaterThan(lo, hi + 20)   // фильтр открыт — луна выше
  }

  func testBloodMoonColor() {
    view.lfoBase = { _, _ in 0.8 }
    tick(mirror(cut: 0.3))
    XCTAssertEqual(view.geo.moon.lfo, 1, accuracy: 1e-9)
    let red = moonMedian(shot { p, d in view.drawMoon(p, d, nowMs: 1100, sun: true) })
    XCTAssertGreaterThan(red.r, red.g + 40)
    var plain: [(r: Int, g: Int, b: Int)] = []
    for base in [nil, Double.nan] {                    // база пропала или не конечна — обычная луна
      view.lfoBase = { _, _ in base }
      tick(mirror(cut: 0.42), now: 1.2)
      XCTAssertEqual(view.geo.moon.lfo, -1)
      plain.append(moonMedian(shot { p, d in view.drawMoon(p, d, nowMs: 1200, sun: true) }))
    }
    XCTAssertEqual(plain[0].r, plain[1].r); XCTAssertEqual(plain[0].g, plain[1].g)
    // свет LIGHT 238,198,126: красный > зелёный > синий, а красно-зелёная разница мала (у крови — 40+)
    XCTAssertGreaterThan(plain[0].r, plain[0].g)
    XCTAssertGreaterThan(plain[0].g, plain[0].b + 20)
    XCTAssertLessThan(plain[0].r - plain[0].g, 40)
  }

  func testEchoRings() {
    let B = view.geo.P(view.buoy.u, view.buoy.d)
    view.state.heard(0, isleOn: true, dt: 0.25, fb: 0.9, now: 1.0)
    func ring(_ now: Double) -> Int {                 // свет в окне вокруг буя; тело буя качается слабо — на разницу не влияет
      let R = 76 * B.s * 1.4
      return litPixels(shot { p, d in view.drawBuoy(p, d, nowMs: now * 1000) }, in: CGRect(x: B.x - R, y: B.y - R, width: 2 * R, height: 2 * R), bg: bg)
    }
    XCTAssertGreaterThan(ring(2.0), ring(6.0) + 20)   // круги отжили (fb 0.9 — последний повтор k=14 живёт до 4.9 с)
  }

  func testIsleFlash() {
    tick(mirror(on: [3], playing: true, step: 3))
    view.state.heard(3, isleOn: true, dt: 0.25, fb: 0.5, now: 1.1)
    func g(_ nowMs: Double, _ cur: Bool, over: Int = 60) -> Int { gold(shot { p, d in view.drawIsle(p, d, nowMs: nowMs, j: 3, cur: cur) }, over: over) }
    XCTAssertGreaterThan(g(1100, true), 0)
    XCTAssertGreaterThan(g(1100, true, over: 90), 0)    // удар: штрих корпуса 0.94 золота
    XCTAssertEqual(g(1700, true, over: 90), 0)          // через 0.6 с вспышка ушла (остаётся ровный свет 0.7)
    XCTAssertEqual(g(1100, false), 0)                   // не текущий — без золота
  }

  func testFogRows() {
    func lit(_ amt: Double) -> Int {
      tick(mirror(fog: amt))
      let img = shot { p, d in view.drawFog(p, d, nowMs: 1100) }
      return litPixels(img, in: CGRect(x: 0, y: 150, width: 390, height: view.geo.hor + 60 - 150), bg: bg)
    }
    XCTAssertGreaterThan(lit(1), lit(0))                // гуще — больше строк
  }

  func testDrawExtremes() {
    let all: [Int] = Array(0..<16)
    for v in [0.0, 1.0] {
      tick(mirror(on: all, playing: true, step: 15, cut: v, res: v, fog: v, fx: v), now: 5)
      view.state.heard(15, isleOn: true, dt: 0.25, fb: 0.98, now: 3.0)
      _ = shot { p, d in
        view.drawMoon(p, d, nowMs: 5000, sun: true); view.drawMoon(p, d, nowMs: 5000, sun: false)
        view.drawQuay(p, d, nowMs: 5000, cs: 15)
        for j in 0..<16 { view.drawIsle(p, d, nowMs: 5000, j: j, cur: j == 15) }
        view.drawBuoy(p, d, nowMs: 5000); view.drawFog(p, d, nowMs: 5000); view.drawPharos(p, d, nowMs: 5000, cs: 15)
      }
    }
    // старше 1.4 с кругов нет: как без ударов
    let B = view.geo.P(view.buoy.u, view.buoy.d), R = 76 * B.s * 1.4, rect = CGRect(x: B.x - R, y: B.y - R, width: 2 * R, height: 2 * R)
    let clean = litPixels(shot { p, d in view.drawBuoy(p, d, nowMs: 9000) }, in: rect, bg: bg)
    view.state.heard(0, isleOn: true, dt: 0.25, fb: 0.5, now: 7.0)
    XCTAssertEqual(litPixels(shot { p, d in view.drawBuoy(p, d, nowMs: 9000) }, in: rect, bg: bg), clean)
  }

  // ---------- кадр целиком (PorFrame) ----------
  private func finger(_ o: NSObject, _ x: Double, _ y: Double) -> Finger {
    Finger(id: ObjectIdentifier(o), x: CGFloat(x), y: CGFloat(y), x0: CGFloat(x), y0: CGFloat(y), t0: 0, moved: false, touchTime: 0)
  }
  private func frame(_ v: PortusView? = nil, now: Double = 1.1, sun: Bool = true, size: CGSize? = nil) -> CGImage {
    let v = v ?? view
    return shot(size: size) { _, d in v.drawFrame(d, now: now, sun: sun) }
  }

  func testDrawPure() {
    let fresh = PortusView(core: rec, readMirror: { _ in 0 }, readHeard: { _ in 0 }, rng: { 0.5 })   // до первого tick: зеркало пустое
    fresh.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    _ = frame(fresh, now: 0.5)
    tick(mirror(on: [3, 9], playing: true, step: 3))
    view.state.heard(3, isleOn: true, dt: 0.25, fb: 0.6, now: 1.05)
    view.state.kill(x: 200, y: 120, now: 1.0)
    view.state.heard(9, isleOn: true, dt: 0.25, fb: 0.6, now: 1.06)
    let o = NSObject(), q = view.geo.slotPt(3, view.isle(3).p)
    view.down(finger(o, q.x, q.y))
    let hits = view.state.hits.count, kill = view.state.killAt, fingers = view.fingers.count, kxy = view.state.killXY
    _ = frame(now: 1.1); _ = frame(now: 1.1)
    XCTAssertEqual(view.state.hits.count, hits); XCTAssertEqual(view.state.killAt, kill)
    XCTAssertEqual(view.fingers.count, fingers); XCTAssertEqual(view.state.killXY.x, kxy.x)
    XCTAssertEqual(fingers, 1)
  }

  func testShotNoMoon() {
    let M = view.geo.moon
    func centre(_ img: CGImage) -> (r: Int, g: Int, b: Int) {
      let px = rgba(img), o = (Int(M.y) * img.width + Int(M.x + M.r * 0.5)) * 4
      return (Int(px[o]), Int(px[o + 1]), Int(px[o + 2]))
    }
    let off = centre(frame(sun: false)), on = centre(frame(sun: true))
    XCTAssertLessThanOrEqual(abs(off.r - Int(bg.r)), 6); XCTAssertLessThanOrEqual(abs(off.g - Int(bg.g)), 6); XCTAssertLessThanOrEqual(abs(off.b - Int(bg.b)), 6)
    XCTAssertGreaterThan(on.r, Int(bg.r) + 30)
  }

  func testStarFades() {
    let rect = CGRect(x: 150, y: 100, width: 80, height: 60)
    func lit(_ now: Double) -> Int { litPixels(frame(now: now), in: rect, bg: bg) }
    let none = lit(2.0)
    view.state.kill(x: 200, y: 120, now: 1)
    XCTAssertGreaterThan(lit(1.3), none + 5)
    XCTAssertEqual(lit(2.0), none)                       // старше 0.9 с — звезды нет
  }

  func testCaptionsOnlyWhileHeld() {
    tick(mirror(on: [3]))
    let p = view.geo.slotPt(3, view.isle(3).p), y = p.y - 30 - 22 * p.s
    let band = CGRect(x: p.x - 60, y: y - 8, width: 120, height: 16)
    let o = NSObject()
    let free = litPixels(frame(), in: band, bg: bg)
    view.down(finger(o, p.x, p.y))
    let held = litPixels(frame(), in: band, bg: bg)
    view.up(finger(o, p.x, p.y))
    XCTAssertGreaterThan(held, free + 20)
    XCTAssertEqual(litPixels(frame(), in: band, bg: bg), free)
  }

  func testDrawWide() {
    view.layout(W: 1024, H: 1366, topY: 50, safeBot: 34)
    tick(mirror(on: [2, 10], playing: true, step: 2), now: 1.2)
    let img = frame(size: CGSize(width: 1024, height: 1366))
    let G = view.geo
    var cols = 0, lit = 0
    let x0 = G.P(Por.edge(-1, 1), 1).x, x1 = G.P(Por.edge(1, 1), 1).x      // линия горизонта — между мысами на всю воду
    var x = x0 + 8
    while x < x1 - 8 { cols += 1; if litPixels(img, in: CGRect(x: x, y: G.hor - 3, width: 2, height: 7), bg: bg) > 0 { lit += 1 }; x += 8 }
    XCTAssertGreaterThan(cols, 20)
    XCTAssertGreaterThan(Double(lit) / Double(cols), 0.95)
  }
}
