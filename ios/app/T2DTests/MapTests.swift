import XCTest
import CoreText
@testable import T2D

final class MapTests: XCTestCase {
  override class func setUp() {   // шрифты бандла тестов (как в DrawTests): лица рисуют названия
    let urls = Bundle(for: MapTests.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
    for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
  }

  // эталон — Node по host/deck.js field() / cellRect() при scopeY = 47, safeBot = 34, W 390, H 844
  func testFieldMatchesDeckJs() {
    let f = MapGeo.field(W: 390, H: 844, top: 47, safeBot: 34)
    XCTAssertEqual(f.gap, 5.46, accuracy: 0.01)
    XCTAssertEqual(f.cw, 90.405, accuracy: 0.01)
    XCTAssertEqual(f.ch, 165.52, accuracy: 0.01)
    XCTAssertEqual(f.x0, 6, accuracy: 0.01)
    XCTAssertEqual(f.y0, 87, accuracy: 0.01)
    XCTAssertEqual(f.sy, 443.5, accuracy: 0.01)
    XCTAssertEqual(f.fw, 378, accuracy: 0.01)
    XCTAssertEqual(f.rect(col: 3, row: 0).minX, 293.595, accuracy: 0.01)
    XCTAssertEqual(f.rect(col: 0, row: 2).minY, 463.5, accuracy: 0.01)
    XCTAssertEqual(f.rect(col: 0, row: 3).maxY, 800, accuracy: 0.01)
  }

  func testFieldNarrowClamp() {
    let f = MapGeo.field(W: 320, H: 568, top: 20, safeBot: 0)
    XCTAssertLessThanOrEqual(f.cw, 0.72 * f.ch + 1e-9)
    XCTAssertLessThanOrEqual(f.ch, f.cw / 0.52 + 1e-9)
    let last = f.rect(col: 3, row: 3)
    XCTAssertGreaterThanOrEqual(f.x0, 0)
    XCTAssertLessThanOrEqual(last.maxX, 320)
    XCTAssertGreaterThanOrEqual(f.y0, 0)
    XCTAssertLessThanOrEqual(last.maxY, 568)
  }

  func testHitCells() {
    let W: CGFloat = 390
    let f = MapGeo.field(W: W, H: 844, top: 47, safeBot: 34)
    var cells = Worlds.all.map { (col: $0.col, row: $0.row) }
    cells += Worlds.backs
    XCTAssertEqual(cells.count, 16)
    for (c, r) in cells {
      let p = f.rect(col: c, row: r)
      let want: MapHit = (c == 3 && r == 1) ? .world(10) : (c == 3 && r == 2) ? .world(8) : (c == 0 && r == 2) ? .world(9) : (c == 1 && r == 3) ? .world(7) : (c == 0 && r == 3) ? .world(12) : (c == 3 && r == 0) ? .world(11) : .peek(col: c, row: r)
      XCTAssertEqual(MapGeo.hit(f, W: W, x: p.midX, y: p.midY), want, "cell \(c),\(r)")
      XCTAssertEqual(MapGeo.hit(f, W: W, x: p.maxX + f.gap / 2, y: p.midY), want, "gap right \(c),\(r)")
      if r != 1 { XCTAssertEqual(MapGeo.hit(f, W: W, x: p.midX, y: p.maxY + f.gap / 2), want, "gap below \(c),\(r)") }   // под рядом 1 — солнце и concordia съедают
    }
    XCTAssertEqual(MapGeo.hit(f, W: W, x: W / 2, y: f.sy), .sun)
    XCTAssertEqual(MapGeo.hit(f, W: W, x: W / 2 + 60, y: f.sy), .sun)
    XCTAssertEqual(MapGeo.hit(f, W: W, x: W / 2 + 130, y: f.sy), .eat, "за подписью concordia — пусто")
    XCTAssertEqual(MapGeo.hit(f, W: W, x: 2, y: 20), .eat)
  }

  func testRegistry() {
    XCTAssertEqual(Worlds.all.count, 12)
    XCTAssertEqual(Set(Worlds.all.map { $0.slot }), [1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15])
    let cells = Worlds.all.map { "\($0.col),\($0.row)" }
    XCTAssertEqual(Set(cells).count, 12)
    for b in Worlds.backs { XCTAssertFalse(cells.contains("\(b.col),\(b.row)")) }
    XCTAssertEqual(Worlds.all.filter { $0.view }.map { $0.slot }, [7, 8, 9, 10, 11, 12])
    XCTAssertEqual(Worlds.info(10)?.title, "Firmamentum")
    XCTAssertEqual(Worlds.at(col: 3, row: 1)?.slot, 10)
    let fi = Worlds.info(10)!.theme, na = Worlds.info(4)!.theme
    XCTAssertEqual(fi.ink.r, 232); XCTAssertEqual(fi.ink.g, 224); XCTAssertEqual(fi.ink.b, 200)
    XCTAssertEqual(fi.paper.r, 10); XCTAssertEqual(fi.paper.b, 20)
    XCTAssertEqual(na.ink.r, 38); XCTAssertEqual(na.paper.r, 226); XCTAssertEqual(na.paper.b, 174)
  }

  func testNavOutIn() {
    var n = Nav()
    n.view = .world(10); n.anim = (0, true, 10)
    XCTAssertEqual(n.out(0), 0, accuracy: 1e-9)
    XCTAssertEqual(n.out(0.26), 0.5, accuracy: 1e-9)
    XCTAssertEqual(n.out(0.52), 1, accuracy: 1e-9)
    XCTAssertTrue(n.busy(0.3))
    XCTAssertNil(n.step(0.6))
    XCTAssertEqual(n.view, .map)
    XCTAssertNil(n.anim)
    XCTAssertFalse(n.busy(0.7))
    XCTAssertEqual(n.out(1), 1)
    n.anim = (0, false, 10)
    XCTAssertEqual(n.out(0.26), 0.5, accuracy: 1e-9)
    XCTAssertEqual(n.out(0), 1, accuracy: 1e-9)
    XCTAssertEqual(n.step(0.6), 10)
    XCTAssertEqual(n.view, .world(10))
    XCTAssertNil(n.anim)
    XCTAssertEqual(n.out(1), 0)
    n.anim = (0, true, 10); n.freeze = 0.25
    XCTAssertEqual(n.k(5), 0.25)
  }

  func testPeek() {
    var n = Nav()
    n.peek = (0, 1, 0)
    XCTAssertNil(n.step(0.41)); XCTAssertNotNil(n.peek)
    XCTAssertFalse(n.busy(0.1))
    XCTAssertNil(n.step(0.43)); XCTAssertNil(n.peek)
  }

  func testLevelsDecayAndSanitize() {
    var l = Levels()
    var calls = 0
    func poll(_ t: Double, _ v: Float) { l.poll(now: t) { b in calls += 1; b[3] = v; return true } }
    poll(0, 0.5); XCTAssertEqual(l.lv[3], 0.5, accuracy: 1e-6)
    poll(0.06, 0); XCTAssertEqual(l.lv[3], 0.41, accuracy: 1e-6)
    poll(0.12, 0); XCTAssertEqual(l.lv[3], 0.3362, accuracy: 1e-6)
    poll(0.15, 0.9); XCTAssertEqual(calls, 3)
    XCTAssertEqual(l.lv[3], 0.3362, accuracy: 1e-6)
    var s = Levels()
    s.poll(now: 0) { $0[0] = .nan; $0[1] = -1; $0[2] = .infinity; return true }
    XCTAssertEqual(s.lv[0], 0); XCTAssertEqual(s.lv[1], 0); XCTAssertEqual(s.lv[2], 0)
  }

  func testLevelsExpireWithoutFreshSnapshot() {
    var l = Levels()
    l.poll(now: 0) { $0[3] = 0.5; return true }
    XCTAssertEqual(l.lv[3], 0.5, accuracy: 1e-6)
    l.poll(now: 0.2) { _ in false }                    // снимка нет, но 0.3 с ещё не прошло — держим rms
    XCTAssertEqual(l.lv[3], 0.5, accuracy: 1e-6)
    l.poll(now: 0.4) { _ in false }                    // движок встал: уровни 0, лучи спадают
    XCTAssertEqual(l.lv[3], 0.5 * 0.82, accuracy: 1e-6)
    l.poll(now: 0.46) { _ in false }
    XCTAssertEqual(l.lv[3], 0.5 * 0.82 * 0.82, accuracy: 1e-6)
    l.poll(now: 0.52) { $0[3] = 0.9; return true }      // движок ожил
    XCTAssertEqual(l.lv[3], 0.9, accuracy: 1e-6)
  }

  func testEmblemsAllSlots() {
    let sc = Draw.scale, w: CGFloat = 90.4, h: CGFloat = 165.5
    for info in Worlds.all {
      guard let img = Emblems.face(info.slot, w: w, h: h) else { return XCTFail("нет лица слота \(info.slot)") }
      XCTAssertEqual(img.width, Int((w * sc).rounded(.up)), "слот \(info.slot)")
      XCTAssertEqual(img.height, Int((h * sc).rounded(.up)), "слот \(info.slot)")
    }
    XCTAssertNil(Emblems.face(3, w: w, h: h))
    XCTAssertNotNil(Emblems.back(w: w, h: h))
  }

  func testEmblemsCached() {
    let a = Emblems.face(10, w: 90.4, h: 165.5), b = Emblems.face(10, w: 90.4, h: 165.5), c = Emblems.face(10, w: 80, h: 150)
    XCTAssertNotNil(a)
    XCTAssertTrue(a === b)
    XCTAssertFalse(a === c)
    XCTAssertTrue(Emblems.back(w: 90.4, h: 165.5) === Emblems.back(w: 90.4, h: 165.5))
  }
}
