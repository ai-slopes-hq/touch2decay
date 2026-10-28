import XCTest

final class HostConstTests: XCTestCase {
  func testVolGain() {
    XCTAssertEqual(Vol.gain(Vol.def), 1, accuracy: 1e-9)
    XCTAssertEqual(Vol.gain(0.004), 0)
  }

  func testVolText() {
    XCTAssertEqual(Vol.text(0.004), "off")
    XCTAssertEqual(Vol.text(Vol.def), "0 dB")
    XCTAssertEqual(Vol.text(1), "+6 dB")
    XCTAssertEqual(Vol.text(0.5), "-21 dB")
  }

  func testScales() {
    XCTAssertEqual(Scales.labels.count, 6)
    XCTAssertEqual(Scales.notes.count, 12)
  }
}
