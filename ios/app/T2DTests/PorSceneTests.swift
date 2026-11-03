import XCTest
@testable import T2D

// стена Portus: ключ кеша, воспроизводимость (LCG 13), что нарисовано (view.js:142-214)
final class PorSceneTests: XCTestCase {
  private let size = CGSize(width: 390, height: 844)
  private let ink: RGB = (196, 208, 216), bg: RGB = (6, 9, 13)
  private let major = PorScale(pcs: [0, 2, 4, 5, 7, 9, 11], root: 0)
  private let minor = PorScale(pcs: [0, 2, 3, 5, 7, 8, 10], root: 0)

  private func geo(fog: Double = 0.45) -> PorGeo {
    PorGeo(W: 390, H: 844, topY: 50, safeBot: 34, cut: 0.42, fogAmt: fog, cutBase: nil)
  }
  private func bytes(_ i: CGImage?) -> Data { i!.dataProvider!.data! as Data }

  func testLCG13() {
    var r = NatLCG(seed: 13)
    XCTAssertEqual(r.next(), 218491.0 / 2147483647, accuracy: 1e-15)
    XCTAssertEqual(r.next(), 1524694590.0 / 2147483647, accuracy: 1e-15)
  }

  func testWallKey() {
    let w = PorWall(), G = geo()
    w.update(G, size: size, dpr: 2, scl: major, ink: ink, bg: bg)
    w.update(G, size: size, dpr: 2, scl: major, ink: ink, bg: bg)
    XCTAssertEqual(w.builds, 1)
    w.update(geo(fog: 0.9), size: size, dpr: 2, scl: major, ink: ink, bg: bg)   // fogTop меняется, ключ нет
    XCTAssertEqual(w.builds, 1)
    w.update(G, size: size, dpr: 2, scl: minor, ink: ink, bg: bg)
    XCTAssertEqual(w.builds, 2)
    w.update(PorGeo(W: 390, H: 800, topY: 50, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: nil), size: CGSize(width: 390, height: 800), dpr: 2, scl: minor, ink: ink, bg: bg)
    XCTAssertEqual(w.builds, 3)
    w.update(PorGeo(W: 390, H: 800, topY: 50, safeBot: 34, cut: 0.42, fogAmt: 0.45, cutBase: nil), size: CGSize(width: 390, height: 800), dpr: 1, scl: minor, ink: ink, bg: bg)
    XCTAssertEqual(w.builds, 4)
  }

  func testWallSame() {
    let A = PorWall(), B = PorWall(), C = PorWall(), G = geo()
    A.update(G, size: size, dpr: 2, scl: major, ink: ink, bg: bg)
    B.update(G, size: size, dpr: 2, scl: major, ink: ink, bg: bg)
    C.update(G, size: size, dpr: 2, scl: minor, ink: ink, bg: bg)
    XCTAssertEqual(bytes(A.img), bytes(B.img))
    XCTAssertNotEqual(bytes(A.img), bytes(C.img))
  }

  func testWallDrawn() {
    let w = PorWall(), G = geo()
    w.update(G, size: size, dpr: 2, scl: major, ink: ink, bg: bg)
    let img = w.img!
    XCTAssertEqual(img.width, 780); XCTAssertEqual(img.height, 1688)
    // вода без штрихов: медиана 3×3 у P(0, 0.5) — фон
    let p = G.P(0, 0.5), data = bytes(img)
    var ch: [[Int]] = [[], [], []]
    for dy in -1...1 { for dx in -1...1 {
      let o = (Int(p.y * 2) + dy) * img.bytesPerRow + (Int(p.x * 2) + dx) * 4
      for c in 0..<3 { ch[c].append(Int(data[o + 1 + c])) }
    } }
    let want = [6, 9, 13]
    for c in 0..<3 { XCTAssertEqual(Double(ch[c].sorted()[4]), Double(want[c]), accuracy: 3) }
    XCTAssertGreaterThan(litPixels(img, in: CGRect(x: 0, y: (G.hor - 1) * 2, width: 780, height: 6), bg: bg), 0)
    let c = G.P(Por.edge(-1, 0.5), 0.5)
    XCTAssertGreaterThan(litPixels(img, in: CGRect(x: (c.x - 4) * 2, y: (c.y - 4) * 2, width: 16, height: 16), bg: bg), 0)
  }
}
