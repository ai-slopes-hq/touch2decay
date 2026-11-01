import XCTest
@testable import T2D

final class NatSceneTests: XCTestCase {
  override class func setUp() {
    let urls = Bundle(for: NatSceneTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  let G = NatGeo(W: 390, H: 844, topY: 50, safeBot: 34)
  let ink: RGB = (38, 26, 16), pap: RGB = (226, 211, 174)
  let size = CGSize(width: 390, height: 844)

  func testLCG() {
    var r = NatLCG()
    XCTAssertEqual(r.next(), 184877.0 / 2147483647, accuracy: 1e-15)
    XCTAssertEqual(r.next(), 959744092.0 / 2147483647, accuracy: 1e-15)
  }

  func testLayersKey() {
    let L = NatLayers()
    L.update(G, size: size, dpr: 2, res: 0.25, ink: ink, pap: pap)
    L.update(G, size: size, dpr: 2, res: 0.25, ink: ink, pap: pap)
    XCTAssertEqual([L.skyBuilds, L.landBuilds], [1, 1])
    L.update(G, size: size, dpr: 2, res: 0.26, ink: ink, pap: pap)
    XCTAssertEqual([L.skyBuilds, L.landBuilds], [1, 1])
    L.update(G, size: size, dpr: 2, res: 0.5, ink: ink, pap: pap)
    XCTAssertEqual([L.skyBuilds, L.landBuilds], [1, 2])
    L.update(G, size: CGSize(width: 390, height: 800), dpr: 2, res: 0.5, ink: ink, pap: pap)
    XCTAssertEqual([L.skyBuilds, L.landBuilds], [2, 3])
    L.update(G, size: CGSize(width: 390, height: 800), dpr: 1, res: 0.5, ink: ink, pap: pap)
    XCTAssertEqual([L.skyBuilds, L.landBuilds], [3, 4])
  }

  func bytes(_ i: CGImage?) -> Data { i!.dataProvider!.data! as Data }

  func testLandSameAfterResChange() {
    let A = NatLayers(), B = NatLayers()
    A.update(G, size: size, dpr: 2, res: 0.25, ink: ink, pap: pap)
    A.update(G, size: size, dpr: 2, res: 0.5, ink: ink, pap: pap)
    B.update(G, size: size, dpr: 2, res: 0.5, ink: ink, pap: pap)
    XCTAssertEqual(bytes(A.land), bytes(B.land))
  }

  // пиксель (x, y) в точках; формат premultipliedFirst: A R G B
  func px(_ i: CGImage, _ x: Int, _ y: Int) -> [Int] {
    let d = bytes(i), bpr = i.bytesPerRow, o = y * bpr + x * 4
    return (0..<4).map { Int(d[o + $0]) }
  }

  func testSkyPaper() {
    let L = NatLayers()
    L.update(G, size: size, dpr: 2, res: 0.25, ink: ink, pap: pap)
    let s = L.sky!
    XCTAssertEqual(s.width, 780); XCTAssertEqual(s.height, 1688)
    var ch: [[Int]] = [[], [], []]
    for dy in -1...1 { for dx in -1...1 { let v = px(s, 390 + dx, 800 + dy); for c in 0..<3 { ch[c].append(v[c + 1]) } } }
    let want = [226, 211, 174]
    for c in 0..<3 { XCTAssertEqual(Double(ch[c].sorted()[4]), Double(want[c]), accuracy: 3) }
  }

  func testLandDrawn() {
    let L = NatLayers()
    L.update(G, size: size, dpr: 2, res: 0.25, ink: ink, pap: pap)
    let l = L.land!
    let r = G.river(0.5)
    var onRiver = false
    for dy in -3...3 { for dx in -3...3 where px(l, Int((r.x + Double(dx)) * 2), Int((r.y + Double(dy)) * 2))[0] > 200 { onRiver = true } }
    XCTAssertTrue(onRiver)
    var frame = false
    for y in stride(from: 100, to: 1500, by: 7) { for x in 26...32 where px(l, x, y)[0] > 0 { frame = true } }
    XCTAssertTrue(frame)
    XCTAssertEqual(px(l, Int(G.W / 2 * 2), Int((G.top + 5) * 2))[0], 0)
  }
}
