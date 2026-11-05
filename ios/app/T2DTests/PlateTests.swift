import XCTest
@testable import T2D

// плашка с вкладками: список вкладок, геометрия, попадания; W 390, H 844, safeBot 34
final class PlateTests: XCTestCase {
  private func geo(_ tab: PlateTab, rows: Int = 3, tabs: [PlateTab] = PlateTab.allCases) -> PlateGeo {
    PlateGeo.make(Plate(tab: tab), W: 390, H: 844, safeBot: 34, rows: rows, tabs: tabs)
  }

  func testTabsWithoutFxOpenOnScale() {
    XCTAssertEqual(Plate.tabs(hasFx: false, onMap: false), [.scale, .mix, .sys])
    XCTAssertEqual(Plate.tabs(hasFx: true, onMap: false), PlateTab.allCases)
  }

  func testMapTabsExcludeFx() {
    XCTAssertEqual(Plate.tabs(hasFx: true, onMap: true), [.scale, .mix, .sys])
  }

  func testFxGeometryMatchesSheet() {   // содержимое fx стоит там же, где панель Sheet: полоса вкладок — над ней
    let spec = SheetSpec(title: "", hint: "", rows: (0..<7).map { SheetRow(key: "k\($0)", label: "", code: $0) },
                         get: { _ in 0 }, set: { _, _ in }, text: { _ in "" }, lfo: SheetLfo(obj: -1, keys: [], shape: 1))
    let s = Sheet(spec: spec, slot: 10)
    XCTAssertEqual(geo(.fx, rows: 7).top, SheetGeo.make(s, W: 390, H: 844, safeBot: 34).top)
    s.lfoKey = "k1"
    let g = PlateGeo.make(Plate(tab: .fx), W: 390, H: 844, safeBot: 34, rows: 7, extra: 196)
    XCTAssertEqual(g.top, SheetGeo.make(s, W: 390, H: 844, safeBot: 34).top)
  }

  func testTapOutsideClosesPlate() {
    let g = geo(.scale)
    XCTAssertEqual(Plate.hit(g, x: 200, y: g.stripTop - 1), .close)
    XCTAssertEqual(Plate.hit(g, x: 200, y: 100), .close)
  }

  func testTabStripHit() {
    let g = geo(.fx), y = g.stripTop + 20
    XCTAssertEqual(Plate.hit(g, x: 10, y: y), .tab(.fx))
    XCTAssertEqual(Plate.hit(g, x: 120, y: y), .tab(.scale))
    XCTAssertEqual(Plate.hit(g, x: 380, y: y), .tab(.sys))
    XCTAssertEqual(Plate.hit(g, x: 100, y: g.top + 5), .content(100, g.top + 5))
  }

  func testScalePickRowsAndRoots() {
    let g = geo(.scale), L = g.scl
    XCTAssertEqual(Plate.sclPick(g, x: L.bx + 20, y: L.top + 23), .off)
    XCTAssertEqual(Plate.sclPick(g, x: L.bx + 20, y: L.top + 46 * 2.5), .scale(1))
    XCTAssertEqual(Plate.sclPick(g, x: L.rx + 5, y: L.top + 5), .root(0))
    XCTAssertEqual(Plate.sclPick(g, x: L.rx + L.cw + 5, y: L.top + L.ch * 1.5), .root(7))
    XCTAssertEqual(Plate.sclPick(g, x: L.bx + PlateGeo.listW + 2, y: L.top + 20), .outside)
  }

  func testMixWindowAndScrollLimit() {
    let g = geo(.mix), keys = Mixer.rows(current: 10)
    XCTAssertEqual(g.bottom - g.top, 16 + CGFloat(Mixer.visibleRows) * Mixer.rowH)
    XCTAssertEqual(Plate.maxScroll(rows: keys.count), CGFloat(keys.count - Mixer.visibleRows) * Mixer.rowH)
    XCTAssertEqual(Plate.maxScroll(rows: 3), 0)
    XCTAssertEqual(Plate.mixHit(g, scroll: 0, keys: keys, x: g.mixTx0 + 5, y: g.top + 8 + 20), .fader(keys[0]))
    XCTAssertEqual(Plate.mixHit(g, scroll: Mixer.rowH, keys: keys, x: g.mixTx0 + 5, y: g.top + 8 + 20), .fader(keys[1]))
    XCTAssertEqual(Plate.mixHit(g, scroll: 0, keys: keys, x: g.mixMx, y: g.top + 8 + 20), .mute(10))
    XCTAssertEqual(Plate.mixHit(g, scroll: 0, keys: keys, x: g.mixTx0 + 5, y: g.top + 2), .none)
  }
}
