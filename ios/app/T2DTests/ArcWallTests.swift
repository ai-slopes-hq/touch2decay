import XCTest
import CoreText
@testable import T2D

final class ArcWallTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: ArcWallTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  let geo = ArcGeo(W: 390, H: 844, topY: 60, safeBot: 34)
  func key(W: Double = 390, hor: Double? = nil, seed: Int = 1, pcs: [Int]? = nil, root: Int = 0) -> ArcWallKey {
    ArcWallKey(W: W, H: 844, dpr: 1, hor: hor ?? geo.hor, gb: geo.gb, Wh: geo.Wh, seed: seed, pcs: pcs, root: root)
  }
  func flat() -> ArcPic {
    ArcPic(seed: 1, z: [Float](repeating: 0, count: Arc.gx * Arc.gy), lake: [Float](repeating: 0, count: Arc.gx * Arc.gy), peaks: [], lakes: [], rivers: [])
  }

  func testLcg() {
    var l = ArcLcg(seed: 4242 % 2147483646 + 1)
    for e in [0.033207284767742866, 0.1148350914543658, 0.03338207352598294] { XCTAssertEqual(l.next(), e, accuracy: 1e-15) }
  }

  func testWallKey() {
    let a = key()
    XCTAssertEqual(a, key())
    XCTAssertNotEqual(a, key(W: 391)); XCTAssertNotEqual(a, key(hor: geo.hor + 1)); XCTAssertNotEqual(a, key(seed: 2))
    XCTAssertNotEqual(a, key(pcs: [0, 2, 4, 5, 7, 9, 11])); XCTAssertNotEqual(a, key(root: 3))
  }

  func testWallCached() {
    let w = ArcWall(), p = flat()
    w.request(key(), geo: geo, pic: p, build: nil); w.request(key(), geo: geo, pic: p, build: nil)
    XCTAssertEqual(w.builds, 1); XCTAssertNotNil(w.image)
    w.request(key(seed: 2), geo: geo, pic: p, build: nil); XCTAssertEqual(w.builds, 2)
    w.request(key(seed: 2, pcs: [0, 2, 4]), geo: geo, pic: p, build: nil); XCTAssertEqual(w.builds, 3)
  }

  func testWallBackgroundKeepsOld() {
    let w = ArcWall(), p = flat(), q = DispatchQueue(label: "wall.test")
    w.request(key(), geo: geo, pic: p, build: nil)
    let old = w.image
    let gate = DispatchSemaphore(value: 0)
    q.async { gate.wait() }                       // держит очередь: постройки не начнутся до проверки
    w.request(key(seed: 2), geo: geo, pic: p, build: q)
    w.request(key(seed: 3), geo: geo, pic: p, build: q)
    XCTAssertTrue(w.image === old)
    gate.signal()
    let ex = expectation(description: "built")
    q.async { DispatchQueue.main.async { DispatchQueue.main.async { ex.fulfill() } } }
    wait(for: [ex], timeout: 20)
    XCTAssertNotNil(w.image); XCTAssertFalse(w.image === old)
    XCTAssertEqual(w.builds, 3)
  }

  func testWallNotBlank() {
    var got: ArcPic?
    ArcPicLoader(queue: nil).load(seed: Arc.seed0) { got = $0 }
    guard let pic = got else { return XCTFail("страна") }
    let w = ArcWall()
    w.request(key(seed: Int(Arc.seed0)), geo: geo, pic: pic, build: nil)
    guard let img = w.image else { return XCTFail("образ") }
    XCTAssertEqual(img.width, 390); XCTAssertEqual(img.height, 844)
    let cs = CGColorSpaceCreateDeviceRGB()
    var px = [UInt8](repeating: 0, count: 390 * 844 * 4)
    let c = CGContext(data: &px, width: 390, height: 844, bitsPerComponent: 8, bytesPerRow: 390 * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue)!
    c.draw(img, in: CGRect(x: 0, y: 0, width: 390, height: 844))
    func inked(_ x0: Int, _ x1: Int, _ y0: Int, _ y1: Int) -> Int {
      var n = 0
      for y in y0..<y1 { for x in x0..<x1 {
        let o = (y * 390 + x) * 4   // BGRA little-endian + premultipliedFirst: B, G, R, A
        if abs(Int(px[o + 2]) - 224) > 12 || abs(Int(px[o + 1]) - 221) > 12 || abs(Int(px[o]) - 198) > 12 { n += 1 }
      } }
      return n
    }
    XCTAssertGreaterThan(inked(Int(geo.fx0) + 12, Int(geo.fx1) - 12, Int(geo.hor) + 2, Int(geo.gb)), 200)
    // у левой рамки засечки лада: правее линии рамки (fx0 + 5.5) на уровне k = 0 (y = gb)
    XCTAssertGreaterThan(inked(Int(geo.fx0) + 6, Int(geo.fx0) + 11, Int(geo.gb) - 1, Int(geo.gb) + 2), 0)
  }
}
