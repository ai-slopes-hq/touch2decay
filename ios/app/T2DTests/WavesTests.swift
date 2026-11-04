import XCTest
@testable import T2D

// числа — из host/waves.js в node (WAVES[i].samp, morphFn, morphName)
final class WavesTests: XCTestCase {
  func testLabels() {
    XCTAssertEqual(Waves.labels, ["triangle", "sharp", "saw", "pulse", "fold", "sync", "crush", "metal", "grain"])
    XCTAssertEqual(Waves.samp.count, 9)
    for s in Waves.samp { XCTAssertEqual(s.count, 1024) }
  }

  func testSamp() {
    let ref: [[Double]] = [
    [-0.0312502458691597, 1, -0.0312502458691597, -0.8485173583030701],
    [0.1830340176820755, 0.7754148244857788, 0.1830340176820755, -0.9960850477218628],
    [-1, -0.36008620262145996, 0.09085342288017273, 0.4178984761238098],
    [-0.624250590801239, 1, -0.624250590801239, -0.6272332668304443],
    [0.430462121963501, 0.012762786820530891, 0.430462121963501, -0.5657860040664673],
    [-0.971143901348114, 0.3892262876033783, -0.23703664541244507, 0.8547288179397583],
    [0.5, 1, -0.5, -1],
    [0, -0.5885013341903687, -1.6538929217653421e-15, 0.4986925721168518],
    [-0.7059797048568726, -0.6533100605010986, 0.5869765281677246, -0.5860168933868408]
    ]
    for (i, row) in ref.enumerated() {
      for (k, idx) in [0, 256, 512, 777].enumerated() {
        XCTAssertEqual(Double(Waves.samp[i][idx]), row[k], accuracy: 1e-5, "\(Waves.labels[i])[\(idx)]")
      }
      XCTAssertEqual(Waves.samp[i].map { abs(Double($0)) }.max()!, 1, accuracy: 1e-6, Waves.labels[i])
    }
  }

  func testWeight() {
    XCTAssertEqual(Waves.weight(0, 0), 1); XCTAssertEqual(Waves.weight(1, 0), 0)
    XCTAssertEqual(Waves.weight(1, 0.0625), 0.5, accuracy: 1e-12)
    XCTAssertEqual(Waves.weight(8, 5), 1)                                // вне 0…1 — зажато
    XCTAssertEqual(Waves.weight(0, .nan), 1)
  }

  func testMorph() {
    XCTAssertEqual(Waves.morph(0, 0.3), Double(Waves.samp[0][307]), accuracy: 1e-12)
    XCTAssertEqual(Waves.morph(0, 0.3), 0.7795995473861694, accuracy: 1e-6)
    XCTAssertEqual(Waves.morph(0.0625, 0.3), 0.5 * Double(Waves.samp[0][307]) + 0.5 * Double(Waves.samp[1][307]), accuracy: 1e-9)
    XCTAssertEqual(Waves.morph(0.0625, 0.3), 0.7730717360973358, accuracy: 1e-6)
    XCTAssertEqual(Waves.morph(0.5, 0.77), -0.5771991014480591, accuracy: 1e-6)
    XCTAssertEqual(Waves.morph(0.9, 0.1), -0.601342678070068, accuracy: 1e-6)
    XCTAssertEqual(Waves.morph(1, 0.9), 1, accuracy: 1e-6)
    XCTAssertEqual(Waves.morph(0.3, -0.2), 0.024924594163894753, accuracy: 1e-6)   // t < 0 заворачивается
    XCTAssertEqual(Waves.morph(0.3, .nan), 0)                                        // не падает
  }

  func testMorphName() {
    XCTAssertEqual(Waves.morphName(0), "triangle"); XCTAssertEqual(Waves.morphName(1), "grain")
    XCTAssertEqual(Waves.morphName(0.0625), "triangle → sharp")
    XCTAssertEqual(Waves.morphName(0.125), "sharp"); XCTAssertEqual(Waves.morphName(0.5), "fold")
    XCTAssertEqual(Waves.morphName(0.07), "triangle → sharp")
    XCTAssertEqual(Waves.morphName(0.9999), "grain"); XCTAssertEqual(Waves.morphName(.nan), "triangle")
  }
}
