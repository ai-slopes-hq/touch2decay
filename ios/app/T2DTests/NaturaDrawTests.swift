import XCTest
@testable import T2D

private final class RecD: Core {
  var acts: [(kind: Int, i: Int, a: [Double])] = []
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { acts.append((kind, i, a)); return true }
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

  private func mirror(bpm: Double = 96, len: Int = 12, fx: [Double] = Nat.fxDef, shake: Double = 0, playing: Bool = false, phase: Double = 0) -> [Double] {
    var b = [Double](repeating: 0, count: Nat.mirrorN)
    b[0] = playing ? phase : -1; b[1] = playing ? 1 : 0; b[4] = bpm; b[5] = Double(len); b[6] = shake
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

  // ---------- кадр целиком: рыба и стрекозы (тик), чистота кадра, широкий экран, дым, хуки сцен ----------
  private func fxs(_ set: [Int: Double]) -> [Double] { var f = Nat.fxDef; for (k, v) in set { f[k] = v }; return f }

  private func frame(_ v: NaturaView, _ w: CGFloat = 390, _ h: CGFloat = 844, now: Double = 1.0) -> UIImage {
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: f).image { r in
      let d = Draw(g: r.cgContext, W: w, H: h); d.setTheme(v.theme)
      v.drawFrame(d, now: now)
    }
  }

  private func rgb(_ img: UIImage, _ x: Int, _ y: Int) -> [Int] {
    let cg = img.cgImage!, b = CFDataGetBytePtr(cg.dataProvider!.data!)!, o = y * cg.bytesPerRow + x * (cg.bitsPerPixel / 8)
    if cg.bitmapInfo.contains(.byteOrder32Little) { return [Int(b[o + 2]), Int(b[o + 1]), Int(b[o])] }
    return [Int(b[o + 1]), Int(b[o + 2]), Int(b[o + 3])]
  }

  func testFishSpawnsOnLoop() throws {
    mirrorBuf = mirror(len: 12, playing: true, phase: 11.9); view.tick(now: 2.0, dt: 0.1)
    XCTAssertNil(view.fish)
    mirrorBuf = mirror(len: 12, playing: true, phase: 12.1); view.tick(now: 2.1, dt: 0.1)
    let f = try XCTUnwrap(view.fish)
    let p = view.geo.river(0.5).across(0)
    XCTAssertEqual(f.x, p.x, accuracy: 1e-9); XCTAssertEqual(f.y, p.y, accuracy: 1e-9)
    XCTAssertEqual(f.s, 1.0, accuracy: 1e-9)
    view.tick(now: 3.8, dt: 1.7)
    XCTAssertNil(view.fish)
  }

  func testFliesRetargetGone() {
    // setUp уже дал стрекозе цель на 6–12 с — ждём, пока срок выйдет
    mirrorBuf = mirror(fx: fxs([3: 1])); heardQ = [[1, 3]]
    view.tick(now: 20.0, dt: 0.1)
    XCTAssertEqual(view.flies[0].i, 3)
    XCTAssertTrue(view.flies.allSatisfy(\.ok))
    view.send(Nat.Act.remove, 3)
    view.tick(now: 20.1, dt: 0.1)
    XCTAssertNotEqual(view.flies[0].i, 3)
    mirrorBuf = mirror(fx: fxs([3: 0.1])); view.tick(now: 20.2, dt: 0.1)
    XCTAssertTrue(view.flies.allSatisfy { !$0.ok })
  }

  func testDrawPure() {
    let fresh = NaturaView(core: rec, readMirror: { _ in 0 }, readHeard: { _ in 0 }, rng: { 0.5 })
    fresh.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    _ = frame(fresh)
    mirrorBuf = mirror(fx: fxs([3: 1]), playing: true, phase: 12.1); heardQ = [[1, 3]]
    view.skiffShot(9, note: 12)
    view.tick(now: 2.0, dt: 0.1)
    XCTAssertNotNil(view.fish)
    let fish = view.fish, flies = view.flies, sx = view.skiff.x, sy = view.skiff.y, tr = view.skiff.trail.count
    _ = frame(view, now: 2.05); _ = frame(view, now: 2.1)
    XCTAssertEqual(view.fish, fish); XCTAssertEqual(view.flies, flies)
    XCTAssertEqual(view.skiff.x, sx); XCTAssertEqual(view.skiff.y, sy); XCTAssertEqual(view.skiff.trail.count, tr)
  }

  func testDrawWide() {
    view.layout(W: 1024, H: 1366, topY: 59, safeBot: 34)
    view.tick(now: 1.1, dt: 0.1)
    let ox = Int(view.geo.ox)
    XCTAssertGreaterThan(ox, 20)
    let img = frame(view, 1024, 1366)
    for (x, y) in [(0, 10), (ox / 2, 683), (ox - 1, 1300), (3, 700)] {
      let c = rgb(img, x, y)
      XCTAssertEqual(c[0], Int(natPap.r), accuracy: 3); XCTAssertEqual(c[1], Int(natPap.g), accuracy: 3); XCTAssertEqual(c[2], Int(natPap.b), accuracy: 3)
    }
    XCTAssertGreaterThan(inkPixels(img, in: CGRect(x: ox + 10, y: 650, width: 8, height: 60)), 0)
  }

  func testDrawSmoke() {
    mirrorBuf = mirror(fx: fxs([3: 1, 4: 1, 5: 0.95]), playing: true, phase: 3.5)
    view.tick(now: 2.0, dt: 0.1)
    let o = NSObject(), g = view.geo, p3 = g.padXY(3, view.pad(3).note)
    let x = CGFloat(p3.x + g.ox), y = CGFloat(p3.y)
    view.down(Finger(id: ObjectIdentifier(o), x: x, y: y, x0: x, y0: y, t0: 0, moved: false, touchTime: 0))
    view.menuShot()
    let img = frame(view, now: 2.1)
    func ink(_ x: Double, _ y: Double, _ r: Double = 18) -> Int { inkPixels(img, in: CGRect(x: x - r + g.ox, y: y - r, width: 2 * r, height: 2 * r)) }
    XCTAssertGreaterThan(ink(p3.x, p3.y), 20)
    let pier = g.pier(); XCTAssertGreaterThan(ink(pier.x, pier.y), 20)
    XCTAssertGreaterThan(ink(view.skiff.x, view.skiff.y), 20)
    let m = view.menuOpts()[0]; XCTAssertGreaterThan(ink(m.x, m.y, 24), 20)
  }

  func testShotHooks() throws {
    view.skiffShot(9, note: 12)
    let a = try XCTUnwrap(rec.acts.last)
    let pt = view.geo.padXY(9, 12), o = view.geo.onRiver(pt.x, pt.y)
    XCTAssertEqual(a.kind, Nat.Act.skiff)
    XCTAssertEqual(a.a[0], o.q, accuracy: 1e-9); XCTAssertEqual(a.a[1], o.t, accuracy: 1e-9)
    XCTAssertTrue(view.skiff.held); XCTAssertFalse(view.skiff.home)
    view.menuShot()
    XCTAssertEqual(view.menu?.held, false)
  }

  func testShotHasNoSun() {
    let g = view.geo, r = g.sun.r
    let rect = CGRect(x: g.ox + g.sun.x, y: g.sun.y, width: r * 0.9, height: r * 0.9)
    let full = inkPixels(frame(view), in: rect)
    let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
    let shotImg = UIGraphicsImageRenderer(size: size, format: f).image { rr in
      let d = Draw(g: rr.cgContext, W: 390, H: 844); d.setTheme(view.theme)
      view.drawShot(d, now: 1.0)
    }
    XCTAssertGreaterThan(abs(full - inkPixels(shotImg, in: rect)), 50)   // солнце есть в кадре и нет в снимке
  }

  func testOddMirrorDoesNotCrash() {
    mirrorBuf = mirror(len: -3, fx: fxs([1: 2.0])); view.tick(now: 1.1, dt: 0.1)
    view.artTick(now: 1.2, dt: 0.1)
    _ = frame(view, now: 1.2)
  }
}
