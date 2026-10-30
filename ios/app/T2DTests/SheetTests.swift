import XCTest
@testable import T2D

// геометрия и попадания плашки (порт host/sheet.js): W 390, H 844, safeBot 34, 7 строк с lfo
final class SheetTests: XCTestCase {
  private let keys = ["scintilla", "drift", "cometa", "crepitus", "fulgur", "spread", "hall"]
  private func sheet(lfo: Bool = true, open: String? = nil) -> Sheet {
    let rows = keys.enumerated().map { SheetRow(key: $1, label: $1, code: 6 + $0) }
    let spec = SheetSpec(title: "aether", hint: "", rows: rows, get: { _ in 0.5 }, set: { _, _ in }, text: { _ in "" },
                         lfo: lfo ? SheetLfo(obj: -1, keys: ["cometa", "hall"], shape: 1) : nil, reset: nil, arc: nil)
    let s = Sheet(spec: spec, slot: 10)
    s.lfoKey = open
    return s
  }
  private let btn = (x: CGFloat(330), y: CGFloat(60), r: CGFloat(20))
  private func geo(_ s: Sheet) -> SheetGeo { SheetGeo.make(s, W: 390, H: 844, safeBot: 34) }

  func testGeometryClosedPanel() {
    let g = geo(sheet())
    XCTAssertEqual(g.top, 428)
    XCTAssertEqual(g.rows[0].y, 476)
    XCTAssertEqual(g.tx0, 98)
    XCTAssertEqual(g.tx1, 250)
    XCTAssertEqual(g.lfoX, 356)
  }

  func testGeometryOpenPanel() {
    let g = geo(sheet(open: "cometa"))
    XCTAssertEqual(g.top, 428 - 196)
    XCTAssertEqual(g.lfoTop, 606)
    XCTAssertEqual(g.panel.pad.y, 684)
    XCTAssertEqual(g.panel.pad.h, 118)
  }

  func testHitClose() {
    let s = sheet(), g = geo(s)
    XCTAssertEqual(sheetHit(s, g, x: 330, y: 60, fxBtn: btn), .close)
    XCTAssertEqual(sheetHit(s, g, x: 200, y: 300, fxBtn: btn), .close)
  }

  func testHitRowsAndLfo() {
    let s = sheet(), g = geo(s)
    let y = g.rows[2].y + 20
    XCTAssertEqual(sheetHit(s, g, x: 200, y: y, fxBtn: btn), .row("cometa"))
    XCTAssertEqual(sheetHit(s, g, x: 340, y: y, fxBtn: btn), .lfo("cometa"))
    XCTAssertEqual(sheetHit(s, g, x: 340, y: g.rows[0].y + 20, fxBtn: btn), .row("scintilla"))
  }

  func testHitPanel() {
    let s = sheet(open: "cometa"), g = geo(s)
    XCTAssertEqual(sheetHit(s, g, x: 16 + 358 - 23, y: 606 + 8 - 6 + 12, fxBtn: btn), .off)
    XCTAssertEqual(sheetHit(s, g, x: 100, y: 606 + 30 + 20, fxBtn: btn), .strip)
    XCTAssertEqual(sheetHit(s, g, x: 100, y: 700, fxBtn: btn), .pad)
  }

  func testPad() {
    let g = geo(sheet(open: "cometa")), p = g.panel
    XCTAssertEqual(Pad.rate(p, p.x + 12), 0.03, accuracy: 1e-9)
    XCTAssertEqual(Pad.rate(p, p.x + p.w - 12), 20, accuracy: 1e-9)
    let x: CGFloat = 150
    XCTAssertEqual(Pad.rateX(p, Pad.rate(p, x)), x, accuracy: 1e-6)
    XCTAssertEqual(Pad.depth(p, p.pad.y + 12), 1, accuracy: 1e-9)
    XCTAssertEqual(Pad.depth(p, p.pad.y + p.pad.h - 12), 0, accuracy: 1e-9)
  }
}
