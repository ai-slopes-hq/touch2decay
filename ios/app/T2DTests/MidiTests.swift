import XCTest
@testable import T2D

final class MidiTests: XCTestCase {
  private func rt(_ w: [UInt32]) -> [UInt8] { w.withUnsafeBufferPointer { umpRealtime($0) } }

  func testUmpRealtimeKeepsClockStartStopContinue() {
    XCTAssertEqual(rt([0x10F80000, 0x10FA0000, 0x10FB0000, 0x10FC0000]), [0xF8, 0xFA, 0xFB, 0xFC])
  }

  func testUmpRealtimeDropsNotesSysexSpp() {
    XCTAssertEqual(rt([0x20903C7F, 0x10F21000, 0x30160000]), [])
  }

  func testMidiOffByDefault() {
    XCTAssertFalse(Midi(feed: { _, _, _ in }).on)
  }
}
