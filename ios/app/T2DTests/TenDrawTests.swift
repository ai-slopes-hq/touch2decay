import XCTest
@testable import T2D

// солнце, дыра, планеты: свет в проверяемых окнах (app.js:1066-1176, 1555-1655)
final class TenDrawTests: XCTestCase {
  override class func setUp() { tenRegisterFonts() }
  private let rig = TenRig()
  private var view: TenebraeView { rig.view }
  private let now = 5.0

  private func pen(_ d: Draw) -> NatPen { NatPen(g: d.g, inkC: view.theme.ink, papC: view.theme.paper) }
  private func win(_ x: Double, _ y: Double, _ s: Double) -> CGRect { CGRect(x: x - s / 2, y: y - s / 2, width: s, height: s) }

  // голос 0: живой, с контуром
  private func setup(pinned: Bool = true, env: Double = 1, envT: Double = 1, extra: ((inout [Double]) -> Void)? = nil) {
    rig.mirror { b in
      self.rig.voice(&b, 0, pinned: pinned, env: env, envT: envT)
      self.rig.scope(&b, 0, peak: 0.5)
      extra?(&b)
    }
    for k in 0..<5 { rig.tick(now - 0.1 + Double(k) * 0.02) }
  }
  private func lit(_ draw: @escaping (NatPen, Draw) -> Void, _ r: CGRect, over: UInt8 = 24) -> Int {
    tenLit(tenShot(view) { d in draw(self.pen(d), d) }, r, over: over)
  }
  private func total(_ img: CGImage) -> Int { tenLit(img, CGRect(x: 0, y: 0, width: img.width, height: img.height), over: 6) }

  func testSunRays() {
    setup()
    let G = view.geo
    let img = tenShot(view) { d in self.view.drawSun(self.pen(d), d, nowMs: self.now * 1000) }
    XCTAssertGreaterThan(tenLit(img, win(G.ox + 28, G.oy - 28, 10)), 0)
    XCTAssertEqual(tenLit(img, win(G.ox - 28, G.oy + 28, 10)), 0, "вне видимой четверти")
  }

  func testLightning() {
    setup()
    let G = view.geo, p = view.screenPos(0)
    let d0 = hypot(p.x - G.ox, p.y - G.oy), a = atan2(p.y - G.oy, p.x - G.ox)
    let mx = G.ox + cos(a) * d0 * 0.5, my = G.oy + sin(a) * d0 * 0.5
    view.strikes = [(0, now, 1, a)]
    var best = 0
    for k in 0..<8 {   // молния мерцает (пропуск 25%): берём лучший из нескольких мгновений того же удара
      let t = now + Double(k) * 0.01
      let img = tenShot(view) { d in self.view.drawSun(self.pen(d), d, nowMs: t * 1000) }
      best = max(best, tenLit(img, win(mx, my, 12), over: 40))
    }
    let late = tenShot(view) { d in self.view.drawSun(self.pen(d), d, nowMs: (self.now + 0.2) * 1000) }
    XCTAssertGreaterThan(best, tenLit(late, win(mx, my, 12), over: 40))
  }

  func testHole() {
    setup()
    let c = view.geo.holeAt
    let img = tenShot(view) { d in self.view.drawHole(self.pen(d), nowMs: self.now * 1000) }
    XCTAssertGreaterThan(tenLit(img, win(c.x + 0.46 * Ten.holeR + 1.5, c.y, 8)), 0)
    XCTAssertEqual(tenLit(img, win(c.x, c.y, 4)), 0, "чёрный диск")
  }

  func testPlanetContour() {
    setup()
    let p = view.screenPos(0), R = tenPlanetR(view.voice(0).amp)
    let img = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    XCTAssertGreaterThan(tenLit(img, win(p.x + R, p.y, 6)), 0, "контур")
    let t = 0.3, lx = (R + 16) * cos(t), ly = 12 * R / 34 * sin(t)       // передняя половина кольца Сатурна, наклон −0.42
    let wx = lx * cos(0.42) + ly * sin(0.42), wy = -lx * sin(0.42) + ly * cos(0.42)
    XCTAssertGreaterThan(tenLit(img, win(p.x + wx, p.y + wy, 6)), 0, "Сатурн")
  }

  func testComet() {
    setup(pinned: false, env: 0.3, envT: 0)
    let p = view.screenPos(0), G = view.geo
    let a = atan2(p.y - G.oy, p.x - G.ox), R = tenPlanetR(view.voice(0).amp)
    let tx = p.x + cos(a) * (R + 20), ty = p.y + sin(a) * (R + 20)
    let img = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    XCTAssertGreaterThan(tenLit(img, win(tx, ty, 8), over: 10), 0, "хвост")
    setup(pinned: true)
    let img2 = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    XCTAssertEqual(tenLit(img2, win(tx, ty, 8), over: 10), 0, "у закреплённой хвоста нет")
  }

  func testPlanetInHole() {
    setup()
    let free = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    view.vw[0].hole = 0.9
    let eaten = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    XCTAssertLessThan(total(eaten), total(free))
  }

  func testMoons() {
    setup(extra: { b in
      let q = Ten.head + 38 + 3 * LfoKey.cut.rawValue
      b[q] = 0; b[q + 1] = 1; b[q + 2] = 0.5
    })
    let p = view.screenPos(0), r = Ten.moonR[LfoKey.cut.rawValue]
    let img = tenShot(view) { d in self.view.drawVoice(self.pen(d), d, 0, nowMs: self.now * 1000) }
    var n = 0
    for k in 0..<12 { let th = Double(k) / 12 * 2 * .pi; n += tenLit(img, win(p.x + cos(th) * r, p.y + sin(th) * r, 4), over: 10) }
    XCTAssertGreaterThan(n, 0)
  }

  func testPlanetHuge() {
    setup(extra: { b in
      let o = Ten.head
      b[o + 6] = 1e300; b[o + 12] = 1e300
      for k in 0..<8 { let q = o + 38 + 3 * k; b[q] = 1e300; b[q + 1] = 1e300; b[q + 2] = 1e300 }
    })
    view.vw[0].hole = 0.5
    let img = tenShot(view) { d in
      self.view.drawVoice(self.pen(d), d, 0, nowMs: 1e300)
      self.view.drawSun(self.pen(d), d, nowMs: 1e300)
      self.view.drawHole(self.pen(d), nowMs: 1e300)
    }
    XCTAssertGreaterThan(img.width, 0)
  }
}
