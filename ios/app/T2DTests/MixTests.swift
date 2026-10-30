import XCTest
@testable import T2D

// модель микшера: числа и подписи — как в вебе (host/audio.js, host/mixer.js)
final class MixTests: XCTestCase {
  func testFaderDb() {
    XCTAssertEqual(Mix.faderDb(Mix.faderDef), 0, accuracy: 1e-12)
    XCTAssertEqual(Mix.faderDb(0), -36, accuracy: 1e-12)
    XCTAssertEqual(Mix.faderDb(1), 6, accuracy: 1e-12)
  }

  func testGain() {
    var m = Mix()
    XCTAssertEqual(m.gain(10), 1, accuracy: 1e-12)          // нет в g — по умолчанию, 0 дБ
    m.mute[10] = true
    XCTAssertEqual(m.gain(10), 0)
    m.mute[10] = false; m.g[10] = 0.005
    XCTAssertEqual(m.gain(10), 0)                            // < 0.01 — off
    m.g[10] = 30.0 / 42
    XCTAssertEqual(m.gain(10), pow(10, -6.0 / 20), accuracy: 1e-12)
  }

  func testFaderText() {
    XCTAssertEqual(Mix.faderText(0.005), "off")
    XCTAssertEqual(Mix.faderText(Mix.faderDef), "0")
    XCTAssertEqual(Mix.faderText(1), "+6")
    XCTAssertEqual(Mix.faderText(0.02), "-35")
  }

  func testMasterText() {
    XCTAssertEqual(MixM.lpf.text(1), "open")
    XCTAssertEqual(MixM.lpf.text(0), "200 Hz")
    XCTAssertEqual(MixM.thr.text(0.25), "-30 dB")
    XCTAssertEqual(MixM.ratio.text(0.136), "2.5 : 1")
    XCTAssertEqual(MixM.ceil.text(0), "-12.0 dB")
    XCTAssertEqual(MixM.allCases.map(\.label), ["low-pass", "compressor", "ratio", "ceiling"])
  }

  func testMasterValues() {
    let c = Mix.def.master()
    XCTAssertEqual(c.lpf, 22000)
    XCTAssertEqual(c.thr, -10, accuracy: 1e-12)
    XCTAssertEqual(c.ratio, 2.496, accuracy: 1e-9)
    XCTAssertEqual(c.ceil, 0, accuracy: 1e-12)
    var m = Mix(); m.lpf = 0.5
    XCTAssertEqual(m.master().lpf, 2000, accuracy: 1e-9)
  }

  func testSubscript() {
    var m = Mix()
    for q in MixM.allCases { XCTAssertEqual(m[q], q.def) }
    m[.thr] = 0.3
    XCTAssertEqual(m.thr, 0.3)
  }
}
