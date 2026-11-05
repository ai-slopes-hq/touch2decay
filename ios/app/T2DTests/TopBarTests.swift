import XCTest
import CoreText
@testable import T2D

// нижний бар: W = 390, H = 844, top = 47, safeBot = 34 (iPhone с вырезом); центры кнопок на y = H − safeBot − 26 = 784
final class TopBarTests: XCTestCase {
  let bar = TopBar(W: 390, top: 47, H: 844, safeBot: 34)
  let y: CGFloat = 784
  let tw: CGFloat = 50

  override class func setUp() {   // шрифты бандла тестов (как в DrawTests)
    let urls = Bundle(for: TopBarTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  func testPositions() {
    XCTAssertEqual(bar.pos(.fx).x, 363); XCTAssertEqual(bar.pos(.fx).y, y)
    XCTAssertEqual(bar.pos(.vol).x, 322)
    XCTAssertEqual(bar.pos(.transport).x, 284)
    XCTAssertEqual(bar.pos(.play).x, 246)
    let b = bar.pos(.back)
    XCTAssertEqual(b.x, 26); XCTAssertEqual(b.y, y); XCTAssertEqual(b.r, 17)
    XCTAssertEqual(TopBar.barH, 52)
  }

  func testRadii() {
    XCTAssertEqual(bar.pos(.fx).r, 20)
    for k in [Btn.vol, .transport, .play, .back] { XCTAssertEqual(bar.pos(k).r, 17) }
  }

  func testHitCentres() {
    for k in Btn.allCases {
      let p = bar.pos(k)
      XCTAssertEqual(bar.hit(p.x, p.y, titleW: tw), .btn(k), "\(k)")
    }
  }

  func testHitRadiiBoundaries() {
    let c = bar.pos(.vol), s = bar.pos(.fx), b = bar.pos(.back)
    XCTAssertEqual(bar.hit(c.x, c.y + 20.9, titleW: tw), .btn(.vol))   // CLR_R + 4 = 21
    XCTAssertNil(bar.hit(c.x, c.y + 21.1, titleW: tw))
    XCTAssertEqual(bar.hit(s.x, s.y + 25.9, titleW: tw), .btn(.fx))    // BTN_R + 6 = 26
    XCTAssertEqual(bar.hit(b.x, b.y - 26.9, titleW: tw), .btn(.back))  // r + 10 = 27
  }

  func testHitMisses() {
    XCTAssertNil(bar.hit(150, y, titleW: tw))        // между back и play
    XCTAssertNil(bar.hit(195, 400, titleW: tw))      // поле мира
  }

  func testTitleHitOnTop() {
    XCTAssertEqual(bar.hit(80, 67, titleW: tw), .title)
    XCTAssertEqual(bar.hit(46 + 50 + 9, 67, titleW: tw), .title)
    XCTAssertNil(bar.hit(46 + 50 + 11, 67, titleW: tw))
    XCTAssertEqual(bar.hit(80, 47 + 37.9, titleW: tw), .title)
    XCTAssertNil(bar.hit(80, 47 + 38.1, titleW: tw))
  }

  func testButtonOrderRightToLeft() {
    let xs = [Btn.fx, .vol, .transport, .play, .back].map { bar.pos($0).x }
    XCTAssertEqual(xs, xs.sorted(by: >))
  }

  func testDisabledButtonHasNoHit() {
    let u = bar.pos(.play)
    XCTAssertEqual(bar.hit(u.x, u.y, titleW: tw), .btn(.play))
    XCTAssertNil(bar.hit(u.x, u.y, titleW: tw, enabled: Set(Btn.allCases).subtracting([.play])))
  }

  func testFiveButtonsDoNotOverlapAtW320() {
    let b = TopBar(W: 320, top: 47, H: 568, safeBot: 0)
    let order = [Btn.fx, .vol, .transport, .play]
    for (a, c) in zip(order, order.dropFirst()) {
      let p = b.pos(a), q = b.pos(c)
      XCTAssertGreaterThanOrEqual(hypot(p.x - q.x, p.y - q.y), p.r + q.r + 2, "\(a) / \(c)")
    }
    XCTAssertGreaterThanOrEqual(b.pos(.play).x - b.pos(.back).x, 2 * 17 + 2)
    let (w, _, _) = TopBar.fit("Tria corpora", max: b.titleMax)
    XCTAssertLessThanOrEqual(TopBar.titleX + w, 320 - 16 + 0.5)
  }

  // красная яркость пикселя (x, y) кадра: фон — чёрный, знаки — светлые
  private func render(_ s: TopBar.State) -> (CGContext, (CGFloat, CGFloat) -> Int) {
    let c = CGContext(data: nil, width: 390, height: 844, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: 844); c.scaleBy(x: 1, y: -1)
    bar.draw(Draw(g: c, W: 390, H: 844), s, now: 0)
    return (c, { x, y in Int(c.data!.assumingMemoryBound(to: UInt8.self)[Int(y) * c.bytesPerRow + Int(x) * 4]) })
  }

  func testDrawSmoke() {
    let c = CGContext(data: nil, width: 390, height: 844, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    XCTAssertGreaterThan(bar.draw(Draw(g: c, W: 390, H: 844), TopBar.State(title: "Firmamentum"), now: 1000), 0)
  }

  func testHeldHighlight() {
    for k in Btn.allCases {
      let p = bar.pos(k)
      let still = render(TopBar.State(title: "x")).1(p.x + p.r, p.y)
      let held = render(TopBar.State(title: "x", held: [k])).1(p.x + p.r, p.y)
      XCTAssertGreaterThan(held, still + 40, "\(k)")
    }
  }

  func testFxStaticNoLoadArc() {
    let r = bar.pos(.fx), px = render(TopBar.State(title: "x")).1(r.x + TopBar.btnR + 5, r.y)
    XCTAssertLessThan(px, 20)   // дуги нагрузки нет
  }

  func testNoTopStripBackground() {
    XCTAssertLessThan(render(TopBar.State(title: "x")).1(300, 10), 5)   // сверху нет подложки
  }

  func testPlayIconSwitches() {
    let p = bar.pos(.play)
    XCTAssertNotEqual(render(TopBar.State(title: "x", playing: true)).1(p.x, p.y),
                      render(TopBar.State(title: "x", playing: false)).1(p.x, p.y))
  }
}
