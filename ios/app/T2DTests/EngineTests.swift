import XCTest
import T2DCore

final class EngineTests: XCTestCase {
  private func render(_ blocks: Int, _ n: Int32) -> Float {
    var l = [Float](repeating: 0, count: Int(n)), r = l, peak: Float = 0
    for _ in 0..<blocks {
      t2d_app_render(&l, &r, n, 0)
      peak = max(peak, l.map { abs($0) }.max()!, r.map { abs($0) }.max()!)
    }
    return peak
  }
  // число звёзд в зеркале слота 10: последнее поле шапки (len = шапка + 14 на звезду); пустое зеркало — 0
  private func stars() -> Int {
    var m = [Double](repeating: 0, count: 1024)
    let len = Int(t2d_app_mirror(10, &m, 1024))
    return len == 0 ? 0 : Int(m[len > 17 ? 16 : len - 1])
  }
  private func star() { var a = [0.3, 0.1]; XCTAssertEqual(t2d_app_action(10, 0, 0, &a, 2, 0), 1) }

  func testRenderSilentThenSound() {
    t2d_app_init(48000, 1, 1e9, 1 << 10)
    XCTAssertEqual(render(1, 512), 0)
    star()
    XCTAssertGreaterThan(render(40, 256), 1e-4)
  }

  func testEngineRestartsOnRateChange() {
    t2d_app_init(48000, 1, 1e9, 1 << 10)
    star()
    _ = render(4, 256)
    XCTAssertGreaterThan(stars(), 0)
    t2d_app_init(44100, 1, 1e9, 1 << 10)
    XCTAssertEqual(stars(), 0, "после init звёзд нет")
    XCTAssertEqual(render(1, 256), 0)
    star()
    XCTAssertGreaterThan(render(40, 256), 1e-4)
  }
}
