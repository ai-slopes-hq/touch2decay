import XCTest
@testable import T2D

final class TenMirrorTests: XCTestCase {
  // буфер зеркала: заголовок 15, голос 15 + 62·i, контуры с 387; значения — «метка» от смещения, флаги и связи — явно
  func buf(full: Bool = true) -> [Double] {
    var b = (0..<(full ? 1161 : 387)).map { 0.001 * Double($0) }
    b[0] = 6; b[1] = 12.5; b[2] = 7; b[8] = 2; b[9] = 3; b[10] = 5
    for k in 11...14 { b[k] = -1 }
    for i in 0..<6 {
      let o = 15 + 62 * i
      b[o] = i == 3 ? 1 : 0; b[o + 1] = 1; b[o + 2] = 0; b[o + 3] = 1               // active, live, pinned, held
      b[o + 17] = 0
      for k in 0..<8 { b[o + 38 + 3 * k + 2] = -1 }                                  // LFO нет
    }
    let o = 15 + 62 * 3
    b[o + 17] = 2
    (b[o + 18], b[o + 19], b[o + 20], b[o + 21]) = (1, 2, 0.6, 0)                    // src 1, am, depth 0.6, ручная
    (b[o + 22], b[o + 23], b[o + 24], b[o + 25]) = (4, 3, 0.25, 1)                   // src 4, rm, авто
    (b[o + 38 + 6], b[o + 38 + 7], b[o + 38 + 8]) = (0.3, 2.5, 0.4)                   // LFO ключа 2: morph 0.3, rate 2.5, depth 0.4
    return b
  }

  func testMirror() {
    let b = buf()
    var m = TenMirror()
    XCTAssertTrue(m.load(b, n: 1161))
    XCTAssertEqual(m.time, 12.5); XCTAssertEqual(m.strikes, 7)
    XCTAssertEqual(m.fx, [b[3], b[4], b[5], b[6], b[7]])
    XCTAssertEqual(m.kept, [3, 5])
    let v = m.v[3], o = 15 + 62 * 3
    XCTAssertTrue(v.active); XCTAssertTrue(v.live); XCTAssertFalse(v.pinned); XCTAssertTrue(v.held)
    XCTAssertFalse(m.v[2].active)
    XCTAssertEqual([v.x, v.y, v.beat, v.wave, v.fm, v.cut, v.res, v.shift, v.amp, v.holeT, v.sunT, v.env, v.envT],
                   (4...16).map { b[o + $0] })
    XCTAssertEqual(v.mods, [TenMod(src: 1, type: 2, depth: 0.6, auto: false), TenMod(src: 4, type: 3, depth: 0.25, auto: true)])
    XCTAssertEqual(v.lfo.count, 8)
    XCTAssertEqual(v.lfo[2], TenLfo(morph: 0.3, rate: 2.5, depth: 0.4))
    for k in 0..<8 where k != 2 { XCTAssertNil(v.lfo[k], "ключ \(k)") }
    XCTAssertEqual(m.v[0].mods, [])
    let sc = m.scope!
    XCTAssertEqual(sc.count, 6); XCTAssertEqual(sc[3].count, 128)
    XCTAssertEqual(sc[3][5], Float(b[387 + 3 * 129 + 1 + 5]))
    XCTAssertEqual(sc[0][0], Float(b[388]))
    XCTAssertEqual(m.scopeLive, (0..<6).map { b[387 + 129 * $0] > 0.5 })
  }

  func testMirrorBad() {
    var m = TenMirror()
    let good = buf()
    XCTAssertTrue(m.load(good, n: 1161))
    let before = m
    XCTAssertFalse(m.load(good, n: 386)); XCTAssertEqual(m, before)
    XCTAssertFalse(m.load([Double](good.prefix(300)), n: 1161)); XCTAssertEqual(m, before)       // короче заявленного
    var b = good; b[0] = 5
    XCTAssertFalse(m.load(b, n: 1161)); XCTAssertEqual(m, before)
    // NaN в x голоса 2 — x прежний, прочее обновлено
    b = good; b[15 + 62 * 2 + 4] = .nan; b[1] = 99
    let x2 = m.v[2].x
    XCTAssertTrue(m.load(b, n: 1161))
    XCTAssertEqual(m.v[2].x, x2); XCTAssertEqual(m.time, 99); XCTAssertEqual(m.v[2].y, b[15 + 62 * 2 + 5])
    // n между 387 и 1161 — модель есть, контуров нет
    XCTAssertTrue(m.load(good, n: 700))
    XCTAssertNil(m.scope); XCTAssertEqual(m.scopeLive, [Bool](repeating: false, count: 6)); XCTAssertEqual(m.kept, [3, 5])
    // и обратно, контуры возвращаются
    XCTAssertTrue(m.load(good, n: 1161)); XCTAssertNotNil(m.scope)
    // связи: src 9 / type 7 / не конечные — пропущены, годные остаются
    b = good; let o = 15 + 62 * 3
    b[o + 18] = 9
    b[o + 23] = 7
    XCTAssertTrue(m.load(b, n: 1161))
    XCTAssertEqual(m.v[3].mods, [])
    b = good; b[o + 20] = .nan
    XCTAssertTrue(m.load(b, n: 1161)); XCTAssertEqual(m.v[3].mods.count, 1); XCTAssertEqual(m.v[3].mods[0].src, 4)
    // число связей больше пяти — только пять
    b = good; b[o + 17] = 99
    XCTAssertTrue(m.load(b, n: 1161)); XCTAssertLessThanOrEqual(m.v[3].mods.count, 5)
    // kept: nkept больше шести и чужие значения не роняют
    b = good; b[8] = 50; b[9] = 9; b[10] = 2
    XCTAssertTrue(m.load(b, n: 1161)); XCTAssertEqual(m.kept, [2])
    // NaN в числе связей — связи прежние не трогаются
    b = good; b[o + 17] = .nan
    XCTAssertTrue(m.load(b, n: 1161))
  }

  // конечные, но огромные значения не роняют разбор (Int(Double) падает вне диапазона)
  func testMirrorHuge() {
    let good = buf(), o = 15 + 62 * 3
    for huge in [-1e300, 1e300] {
      var m = TenMirror()
      var b = good; b[2] = huge; b[8] = huge; b[9] = huge; b[o + 17] = huge
      XCTAssertTrue(m.load(b, n: 1161))
      b = good; b[o + 18] = huge; b[o + 23] = huge
      XCTAssertTrue(m.load(b, n: 1161)); XCTAssertEqual(m.v[3].mods, [])
      b = good; b[o + 17] = huge
      XCTAssertTrue(m.load(b, n: 1161))
      var out: [TenHeard] = []
      tenHeard([1, huge, 1, 3, huge, 1], n: 6, into: &out); XCTAssertEqual(out, [.flash(3)])
      tenHeard([2, huge, 0.5, 2, 1, huge], n: 6, into: &out); XCTAssertEqual(out, [.strike(1, huge)])   // индекс огромный — запись пропущена, сила огромная — годна
    }
  }

  func testHeard() {
    var out: [TenHeard] = []
    tenHeard([1, 2, 2, 4, 0.7], n: 5, into: &out)
    XCTAssertEqual(out, [.flash(2), .strike(4, 0.7)])
    tenHeard([1, 0], n: 2, into: &out)                                                // out очищается
    XCTAssertEqual(out, [.flash(0)])
  }

  func testHeardBad() {
    var out: [TenHeard] = []
    tenHeard([1, 7], n: 2, into: &out); XCTAssertEqual(out, [])
    tenHeard([2, 1], n: 2, into: &out); XCTAssertEqual(out, [])                       // хвост обрезан
    tenHeard([5, 1, 1], n: 3, into: &out); XCTAssertEqual(out, [])
    tenHeard([1, .nan, 1, 3], n: 4, into: &out); XCTAssertEqual(out, [.flash(3)])
    tenHeard([2, 1, .nan, 1, 2], n: 5, into: &out); XCTAssertEqual(out, [.flash(2)])
    tenHeard([1, 2, 5, 1], n: 4, into: &out); XCTAssertEqual(out, [.flash(2)])        // неизвестный вид — стоп
    tenHeard([1, 2], n: 99, into: &out); XCTAssertEqual(out, [.flash(2)])             // n больше буфера
    tenHeard([1, 2], n: 0, into: &out); XCTAssertEqual(out, [])
    tenHeard([1, -1, 1, 6], n: 4, into: &out); XCTAssertEqual(out, [])
    tenHeard([1, 5.7], n: 2, into: &out); XCTAssertEqual(out, [])                      // 5.7 округляется до 6 — вне 0…5
    tenHeard([1, 5.4], n: 2, into: &out); XCTAssertEqual(out, [.flash(5)])
  }
}
