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

  // ---------- рисование ----------
  override class func setUp() {   // шрифты бандла тестов (как в DrawTests)
    let urls = Bundle(for: SheetTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }
  private func bitmap() -> (CGContext, Draw) {
    let c = CGContext(data: nil, width: 390, height: 844, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    c.translateBy(x: 0, y: 844); c.scaleBy(x: 1, y: -1)   // начало слева сверху: строка bitmap i — это y = i
    return (c, Draw(g: c, W: 390, H: 844))
  }
  private func render(_ s: Sheet, _ lfos: [LfoSnap], held: SheetHit? = nil) -> CGContext {
    let (c, d) = bitmap()
    SheetDraw.draw(d, s, geo(s), lfos: lfos, held: held, sample: { _, m, u, _ in sin(u * 6.28 + m) })
    return c
  }
  private func lum(_ c: CGContext, _ x: Int, _ y: Int) -> Int {
    let p = c.data!.assumingMemoryBound(to: UInt8.self), i = y * c.bytesPerRow + x * 4
    return Int(p[i]) + Int(p[i + 1]) + Int(p[i + 2])
  }
  private func snap(_ key: Int) -> LfoSnap {
    LfoSnap(slot: 10, obj: -1, key: key, base: 0.5, morph: 0.4, rate: 1.5, depth: 0.5, u: 0.3, shape: 1, seed: 5)
  }

  func testDrawStates() {
    _ = render(sheet(lfo: false), [])
    _ = render(sheet(), [snap(8)])                       // LFO на строке без панели
    _ = render(sheet(open: "cometa"), [])                // панель без LFO: drag the pad
    _ = render(sheet(open: "cometa"), [snap(8)], held: .pad)   // панель с LFO
  }

  func testLfoTildeFilled() {   // заливка ink 0.14 под «~» у строки с LFO
    let s = sheet(), g = geo(s), r = g.rows[2]   // cometa, код 8
    let x = Int(g.lfoX) - 13, y = Int(r.y + r.h / 2) - 8
    let without = lum(render(s, []), x, y), with = lum(render(s, [snap(8)]), x, y)
    XCTAssertNotEqual(with, without)
  }
}
