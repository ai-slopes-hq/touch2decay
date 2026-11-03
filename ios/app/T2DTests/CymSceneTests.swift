import XCTest
@testable import T2D

private final class Rec: Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true }
}

// показанная высота пластины и кеш волн фона (view.js:624-651)
final class CymSceneTests: XCTestCase {
  private var mirrorBuf: [Double] = []
  private lazy var view = CymaticaView(core: Rec(), readMirror: { [unowned self] b in
    let n = min(self.mirrorBuf.count, b.count); b.replaceSubrange(0..<n, with: self.mirrorBuf[0..<n]); return n
  }, readHeard: { _ in 0 }, seed: { 7 })

  private func mirror(f0: Double) -> [Double] {
    var b = [Double](repeating: 0, count: Cym.mirrorN)
    b[32] = f0
    for (k, v) in [2.0 / 7, 0.5, 0.5, 0.25, 0.15, 0.75, 1].enumerated() { b[33 + k] = v }
    b[40] = 96; b[43] = 16; b[44] = 7
    for i in 0..<Cym.slots { b[45 + 4 * i + 2] = 1 }
    b[158] = 0.3; b[159] = 0.5
    b[162] = 1; b[163] = 0.3; b[165] = -1
    return b
  }

  override func setUp() {
    mirrorBuf = mirror(f0: 110)
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)
    view.tick(now: 1.0, dt: 0.016)
  }

  func testShownF0() {
    XCTAssertEqual(view.shownF0, 110, accuracy: 1e-9)
    mirrorBuf = mirror(f0: 220)
    view.tick(now: 2.0, dt: 0.08)
    let s = 110 + 110 * (1 - exp(-1.0))
    XCTAssertEqual(view.shownF0, s, accuracy: 0.01)
    XCTAssertEqual(view.geo.r, view.geo.rMax * pow(55 / s, 0.25), accuracy: 1e-6)
    view.layout(W: 390, H: 844, topY: 50, safeBot: 34)         // layout не сбрасывает показанную высоту
    XCTAssertEqual(view.shownF0, s, accuracy: 0.01)
  }

  func testShownF0Clamp() {
    mirrorBuf = mirror(f0: 220)
    view.tick(now: 3.0, dt: 1.0)                               // dt зажат до 0.1
    XCTAssertEqual(view.shownF0, 110 + 110 * (1 - exp(-1.25)), accuracy: 0.01)
  }

  func testShownF0Converges() {
    mirrorBuf = mirror(f0: 220)
    for k in 1...60 { view.tick(now: 1.0 + Double(k) * 0.016, dt: 0.016) }
    XCTAssertEqual(view.shownF0, 220, accuracy: 0.5)
  }

  func testWaveStep() {
    XCTAssertEqual(cymWaveStep(12), 24, accuracy: 1e-9)
    XCTAssertEqual(cymWaveStep(24), 24 * pow(2, -1.0 / 3), accuracy: 1e-9)
  }

  private func upd(_ w: CymWaves, W: Double = 390, H: Double = 844, dpr: CGFloat = 2, fs: Double = 12, safeBot: Double = 34) {
    w.update(W: W, H: H, dpr: dpr, fs: fs, topY: 50, safeBot: safeBot, ink: (237, 237, 237), bg: (0, 0, 0))
  }

  func testWavesKey() {
    let w = CymWaves()
    upd(w); upd(w)
    XCTAssertEqual(w.builds, 1)
    upd(w, fs: 12.4)
    XCTAssertEqual(w.builds, 1)
    upd(w, fs: 12.6)
    XCTAssertEqual(w.builds, 2)
    upd(w, H: 900, fs: 12.6)
    XCTAssertEqual(w.builds, 3)
    upd(w, H: 900, dpr: 1, fs: 12.6)
    XCTAssertEqual(w.builds, 4)
    upd(w, H: 900, dpr: 1, fs: 12.6, safeBot: 0)
    XCTAssertEqual(w.builds, 5)
  }

  func testWavesDrawn() {
    let w = CymWaves()
    upd(w)
    let img = w.img!
    XCTAssertEqual(img.width, 780); XCTAssertEqual(img.height, 1688)
    let data = img.dataProvider!.data! as Data, bpr = img.bytesPerRow
    func maxCh(_ px: Int, _ py: Int) -> Int {                  // окно 3×3, старший канал
      var m = 0
      for dy in -1...1 { for dx in -1...1 {
        let o = (py + dy) * bpr + (px + dx) * 4
        m = max(m, Int(data[o + 1]), Int(data[o + 2]), Int(data[o + 3]))
      } }
      return m
    }
    let step = cymWaveStep(12)
    XCTAssertGreaterThanOrEqual(maxCh(Int(step * 2), 100), 6)           // на окружности r = step вокруг (0, topY)
    XCTAssertLessThanOrEqual(maxCh(Int(step * 1.5 * 2), 100), 2)        // между первыми двумя кругами — фон
  }
}
