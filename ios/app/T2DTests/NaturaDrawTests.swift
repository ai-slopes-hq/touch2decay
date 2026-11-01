import XCTest
@testable import T2D

private final class RecD: Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true }
}

// пейзаж в кадре: солнце, птицы, туман, пирс, запруда, камыши, древо, туча, заводь, утки, надгробие (scene.js, view.js)
final class NaturaDrawTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: NaturaDrawTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  private let rec = RecD()
  private var mirrorBuf: [Double] = []
  private var heardQ: [[Double]] = []
  private lazy var view = NaturaView(core: rec, readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, rng: { 0.5 })
  private let size = CGSize(width: 390, height: 844)

  override func setUp() {
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    mirrorBuf = mirror()
    view.tick(now: 1.0, dt: 0.016)
  }

  private func mirror(bpm: Double = 96, len: Int = 12, fx: [Double] = Nat.fxDef, shake: Double = 0) -> [Double] {
    var b = [Double](repeating: 0, count: Nat.mirrorN)
    b[0] = -1; b[4] = bpm; b[5] = Double(len); b[6] = shake
    for k in 0..<Nat.fxDef.count { b[7 + k] = fx[k] }
    for i in 0..<Nat.npad {
      let o = Nat.head + i * Nat.padN
      for k in 4...8 { b[o + k] = -1 }
      if let d = Nat.demo.first(where: { $0.i == i }) { b[o] = 1; b[o + 1] = Double(d.note); b[o + 2] = Double(d.wave) }
    }
    return b
  }

  // холст 390×844, бумага; draw получает кисть и Draw мира
  private func shot(_ draw: (NatPen, Draw) -> Void) -> UIImage {
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    return UIGraphicsImageRenderer(size: size, format: f).image { r in
      let p = NatPen(g: r.cgContext, inkC: natInk, papC: natPap)
      p.fillPap(1); p.fillRect(0, 0, 390, 844)
      let d = Draw(g: r.cgContext, W: 390, H: 844)
      d.setTheme(view.theme)
      draw(p, d)
    }
  }

  // нижняя граница чернил в полосе rect (по строкам)
  private func lastInkRow(_ img: UIImage, _ r: CGRect) -> Double {
    var last = -1.0
    var y = r.minY
    while y < r.maxY { if inkPixels(img, in: CGRect(x: r.minX, y: y, width: r.width, height: 1)) > 0 { last = y }; y += 1 }
    return last
  }
  private func centroidY(_ img: UIImage, _ r: CGRect) -> Double {
    var s = 0.0, n = 0.0
    var y = r.minY
    while y < r.maxY { let c = Double(inkPixels(img, in: CGRect(x: r.minX, y: y, width: r.width, height: 1))); s += c * y; n += c; y += 1 }
    return n > 0 ? s / n : -1
  }

  func testSunSets() {
    func bottom(_ bpm: Double) -> Double {
      mirrorBuf = mirror(bpm: bpm); view.tick(now: 1.1, dt: 0.1)
      return lastInkRow(shot { _, d in view.drawSun(d, nowMs: 1100) }, CGRect(x: 0, y: 0, width: 240, height: 600))
    }
    let hi = bottom(96), lo = bottom(45)
    XCTAssertGreaterThan(hi, 0)
    XCTAssertGreaterThan(lo, hi + 20)   // медленный темп — солнце клонится к горам (sunAt)
    let g = view.geo
    XCTAssertGreaterThan(g.sunAt(bpm: 45).y, g.sunAt(bpm: 96).y + 20)
  }

  func testDucksAway() {
    let pd = view.geo.pond()
    let box = CGRect(x: pd.x - pd.rx - 10, y: pd.y - 60, width: pd.rx * 2 + 20, height: 90)
    func ink(_ ms: Double) -> Int { inkPixels(shot { p, _ in view.drawDucks(p, nowMs: ms) }, in: box) }
    let before = ink(1000)
    view.send(Nat.Act.scare, 0)
    view.tick(now: 1.1, dt: 0.1)
    let early = ink(1100)
    view.tick(now: 3.0, dt: 1.9)
    let away = ink(3000)
    view.tick(now: 7.0, dt: 4)
    let back = ink(7000)
    XCTAssertGreaterThan(before, 0)
    XCTAssertLessThan(away, early)
    XCTAssertEqual(Double(back), Double(before), accuracy: Double(before) * 0.1)
  }

  func testCloudCutoff() {
    func cy(_ cutoff: Double) -> Double {
      var fx = Nat.fxDef; fx[4] = cutoff
      mirrorBuf = mirror(fx: fx); view.tick(now: 1.1, dt: 0.1)
      let img = shot { p, _ in view.drawCloud(p, nowMs: 1100) }
      return centroidY(img, CGRect(x: 0, y: 0, width: 390, height: 400))
    }
    let lo = cy(0), hi = cy(1)
    XCTAssertGreaterThan(lo, 0); XCTAssertGreaterThan(hi, 0)
    XCTAssertGreaterThan(abs(lo - hi), 5)
    XCTAssertGreaterThan(lo, hi)   // cutoff 0 — туча ниже
  }

  func testDrawExtremes() {
    view.splash = (x: 120, y: 700, t0: 1.0)
    for fxv in [0.0, 1.0] {
      for len in [1, 16] {
        mirrorBuf = mirror(bpm: 45, len: len, fx: [Double](repeating: fxv, count: Nat.fxDef.count), shake: fxv)
        heardQ = [[2, 0]]
        view.tick(now: 2.0 + fxv, dt: 0.016)
        view.send(Nat.Act.laser, 0)
        let t = (2.0 + fxv) * 1000 + 100
        let img = shot { p, d in
          view.drawSun(d, nowMs: t); view.drawBirds(p, nowMs: t); view.drawFog(p, nowMs: t); view.drawRainRings(p, nowMs: t)
          view.drawPier(p, nowMs: t); view.drawBridge(p, nowMs: t); view.drawReeds(p, nowMs: t); view.drawTree(p, nowMs: t)
          view.drawCloud(p, nowMs: t); view.drawPond(p, nowMs: t); view.drawDucks(p, nowMs: t); view.drawStone(p, nowMs: t)
        }
        XCTAssertGreaterThan(inkPixels(img, in: CGRect(x: 0, y: 0, width: 390, height: 844)), 1000)
        let g = view.geo, b = g.river(g.bridgeT(len: len))
        XCTAssertTrue((0...g.W).contains(b.x) && (g.top...g.bot).contains(b.y), "bridge \(len) \(b)")
      }
    }
  }

  func testNoStateChange() {
    // кадр ничего не меняет: две подряд отрисовки на одном времени — одинаковые байты
    view.send(Nat.Act.scare, 0)
    func frame() -> Data {
      natBytes(shot { p, d in
        view.drawBirds(p, nowMs: 1500); view.drawTree(p, nowMs: 1500); view.drawDucks(p, nowMs: 1500); view.drawCloud(p, nowMs: 1500)
      })
    }
    XCTAssertEqual(frame(), frame())
  }
}
