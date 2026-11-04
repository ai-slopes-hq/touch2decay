import XCTest
@testable import T2D

// числа — из формул app.js / worlds/tenebrae/tone.js в node (скрипт в репозиторий не кладём)
final class TenMathTests: XCTestCase {
  let acc = 1e-6
  let phone = TenGeo(W: 390, H: 844, topY: 103, safeBot: 34)
  let pad = TenGeo(W: 1024, H: 1366, topY: 68, safeBot: 20)

  func testGeo() {
    XCTAssertEqual(phone.top, 47); XCTAssertEqual(phone.bot, 806); XCTAssertEqual(phone.oy, 806); XCTAssertEqual(phone.ox, 0)
    XCTAssertEqual(phone.a.count, 416); XCTAssertEqual(phone.a[100], 0.11622393703045132, accuracy: acc); XCTAssertEqual(phone.a.last!, 1, accuracy: acc)
    XCTAssertEqual(phone.zoomDef, 0.8573645219195573, accuracy: acc); XCTAssertEqual(phone.menuSpan, 121)
    XCTAssertEqual(pad.top, 12); XCTAssertEqual(pad.bot, 1342)
    XCTAssertEqual(pad.a.count, 829); XCTAssertEqual(pad.a[100], 0.02152963975757556, accuracy: acc)
    XCTAssertEqual(pad.zoomDef, 1); XCTAssertEqual(pad.menuSpan, 150)
    XCTAssertEqual(Ten.zoomDef, pow(0.8, 1 / 1.45), accuracy: 1e-12)
  }

  func testArcSpan() {
    XCTAssertNil(phone.arcSpan(90)); XCTAssertNil(phone.arcSpan(100))
    for (r, lo, hi) in [(200.0, 0.1303689797031455, 1.440427347091751), (400, 0.4275122649448695, 1.5057504687202856), (700, 1.0239453760989525, 1.4512022067182455)] {
      let s = phone.arcSpan(r)!
      XCTAssertEqual(s.lo, lo, accuracy: acc); XCTAssertEqual(s.hi, hi, accuracy: acc)
    }
    let p = pad.arcSpan(700)!
    XCTAssertEqual(p.lo, 0.037151402779609585, accuracy: acc); XCTAssertEqual(p.hi, 1.533644924015287, accuracy: acc)
  }

  func testRadiusOfArea() {
    for (p, r) in zip([0.05, 0.3, 0.7, 1], [169.26182446990848, 331.59935722681917, 543.5833669171905, 784]) {
      XCTAssertEqual(phone.rOfP(p), r, accuracy: acc)
    }
    for (r, p) in zip([150.0, 300, 500], [0.03268472910781641, 0.23675335901780234, 0.6262394561383087]) {
      XCTAssertEqual(phone.pOfR(r), p, accuracy: acc)
    }
    XCTAssertEqual(pad.rOfP(0.3), 713.0775289831948, accuracy: acc)
  }

  func testPlaceNode() {
    let a = phone.place(0.3, 0.5, zoom: 1)
    XCTAssertEqual(a.x, 234.4761541321842, accuracy: acc); XCTAssertEqual(a.y, 571.5238458678158, accuracy: acc)
    let b = phone.place(0.7, 0, zoom: 0.857)
    XCTAssertEqual(b.x, 364, accuracy: acc); XCTAssertEqual(b.y, 311.1536156624625, accuracy: acc)
    let c = phone.place(0.2, 1, zoom: 0.35)
    XCTAssertEqual(c.x, 26, accuracy: acc); XCTAssertEqual(c.y, 338.3544613408315, accuracy: acc)
    XCTAssertEqual(pad.place(0.3, 0.5, zoom: 1).x, 504.221956255764, accuracy: acc)
  }

  func testPlaceRoundTrip() {
    for g in [phone, pad] {
      for p in [0.05, 0.3, 0.7, 1.0] {
        for c in [0.0, 0.5, 1.0] {
          for z in [0.35, 0.857, 1.0] where p <= z {                        // выше горизонта зума место не определено
            let xy = g.place(p, c, zoom: z), q = g.unplace(xy.x, xy.y, zoom: z)
            XCTAssertEqual(q.p, p, accuracy: acc, "p \(p) c \(c) z \(z)"); XCTAssertEqual(q.c, c, accuracy: acc, "p \(p) c \(c) z \(z)")
          }
        }
      }
    }
  }

  func testRAtHorizon() {
    XCTAssertEqual(phone.rAt(0.5, zoom: 0.35), .infinity)
    XCTAssertEqual(phone.rAt(0.35, zoom: 0.35), phone.rOfP(1), accuracy: acc)
    XCTAssertEqual(phone.rAt(0.3, zoom: 1), phone.rOfP(0.3), accuracy: acc)
  }

  func testHole() {
    XCTAssertEqual(phone.holeAt.x, 0); XCTAssertEqual(phone.holeAt.y, 111)
    XCTAssertEqual(phone.holeDepth(0, 111), 1, accuracy: acc)                       // центр
    XCTAssertEqual(phone.holeDepth(84, 111), 0.175, accuracy: acc)                  // край: ядро 0, остаётся краешек
    XCTAssertEqual(phone.holeDepth(60, 147), 0.2783447869415952, accuracy: acc)
    XCTAssertEqual(phone.holeDepth(20, 447), 0.240625, accuracy: acc)               // у края поля
    XCTAssertEqual(phone.holeDepth(200, 347), 0, accuracy: acc)                     // далеко
    XCTAssertEqual(phone.holeDepth(300, 500), 0, accuracy: acc)
    XCTAssertEqual(pad.holeDepth(60, 112), 0.2783447869415952, accuracy: acc)
    for (x, y, ox, oy) in [(0.0, 111.0, 60.81118318204309, 171.8111831820431), (30, 117, 84.32993810941912, 127.86598762188382), (10, 177, 12.883262630807565, 196.0295333633299)] {
      let o = phone.outOfHole(x, y)
      XCTAssertEqual(o.x, ox, accuracy: acc); XCTAssertEqual(o.y, oy, accuracy: acc)
    }
    let o = phone.outOfHole(0, 111), c = phone.holeAt
    XCTAssertEqual(hypot(o.x - c.x, o.y - c.y), Ten.holeR + 2, accuracy: acc)       // на границе горизонта
    let far = phone.outOfHole(300, 500); XCTAssertEqual(far.x, 300); XCTAssertEqual(far.y, 500)
  }

  func testTone() {
    XCTAssertEqual(tenFreq(0), 55); XCTAssertEqual(tenFreq(1), 1760, accuracy: acc)
    XCTAssertEqual(tenFreq(0.5), 195.55990961719434, accuracy: acc)
    XCTAssertEqual(tenSemi(0.5), 21.96128543918438, accuracy: acc); XCTAssertEqual(tenXOf(tenSemi(0.37)), 0.37, accuracy: acc)
    XCTAssertEqual(tenCutoff(0), 40, accuracy: acc); XCTAssertEqual(tenCutoff(1), 18000, accuracy: acc)
    XCTAssertEqual(tenCutoff(0.5), 848.5281374238571, accuracy: acc)
    for (v, hz) in zip([0.0, 0.3, 0.5, 0.8, 1], [-1500, -12.052850798224817, 0, 61.86840547157954, 1500]) { XCTAssertEqual(tenShiftHz(v), hz, accuracy: 1e-9) }
    let minor = [0, 2, 3, 5, 7, 8, 10]
    for (x, q) in zip([0.02, 0.1, 0.33, 0.5, 0.8, 0.97], [0, 0.09578459921738679, 0.3295730727660792, 0.5006077148625586, 0.7947284534130623, 0.976890822905056]) {
      XCTAssertEqual(tenQuantX(x, pcs: minor, root: 0), q, accuracy: acc, "x \(x)")
    }
    let rooted = minor.map { ($0 + 3) % 12 }                                          // тоника C: ноты от A, как Host.pushScale
    for (x, q) in zip([0.02, 0.1, 0.33, 0.5, 0.8, 0.97], [0.05938664527086454, 0.1266887158443285, 0.34827763567223946, 0.5006077148625586, 0.8074291638219012, 0.976890822905056]) {
      XCTAssertEqual(tenQuantX(x, pcs: rooted, root: 3), q, accuracy: acc, "x \(x)")
    }
    XCTAssertEqual(tenQuantX(0.4, pcs: nil, root: 0), 0.4)                           // лад выключен
  }

  func testNorms() {
    for r in Row.allCases where r != .shift {
      for t in [0.2, 0.7, 0.95] { XCTAssertEqual(tenNorm(r, tenSetNorm(r, t)), t, accuracy: acc, "\(r) \(t)") }
    }
    for t in [0.2, 0.7, 0.95] { XCTAssertEqual(tenNorm(.shift, tenSetNorm(.shift, t)), t, accuracy: acc) }
    XCTAssertEqual(tenSetNorm(.shift, 0.51), 0.5); XCTAssertEqual(tenSetNorm(.shift, 0.4801), 0.5); XCTAssertEqual(tenSetNorm(.shift, 0.53), 0.53)
    XCTAssertEqual(tenSetNorm(.beat, 0), 0.05, accuracy: acc); XCTAssertEqual(tenSetNorm(.beat, 1), 24, accuracy: acc)
    for (v, t) in zip([0.05, 0.35, 24], [0, 0.3151891102650066, 1]) { XCTAssertEqual(tenNorm(.beat, v), t, accuracy: acc) }
    XCTAssertEqual(tenSetNorm(.amp, 0.004), 0); XCTAssertEqual(tenSetNorm(.amp, 0.005), 0)
    let t04 = log(pow(10, -0.4 / 20) / 0.05) / log(1.8 / 0.05)                         // −0.4 дБ — защёлка на 1
    XCTAssertEqual(tenSetNorm(.amp, t04), 1)
    XCTAssertNotEqual(tenSetNorm(.amp, 0.5), 1)
    for (v, t) in zip([0.05, 0.5, 1, 1.8], [0, 0.6425486044692345, 0.8359750080865052, 1]) { XCTAssertEqual(tenNorm(.amp, v), t, accuracy: acc) }
    XCTAssertEqual(tenNorm(.amp, 0), 0)
    XCTAssertEqual(Ten.rowDef[.cut], 0.68); XCTAssertEqual(Ten.rowDef[.amp], 1); XCTAssertEqual(Ten.rowDef.count, 7)
    XCTAssertEqual(Row.allCases.map(\.rawValue), [0, 1, 2, 3, 4, 5, 6])
  }

  func testValueText() {
    for (v, s) in zip([0.0, 0.125, 0.0625, 1, 0.5], ["triangle", "sharp", "triangle → sharp", "grain", "fold"]) { XCTAssertEqual(tenValueText(.wave, v), s) }
    for (v, s) in zip([0.0, 0.68, 1], ["40 Hz", "2.5 kHz", "18.0 kHz"]) { XCTAssertEqual(tenValueText(.cut, v), s) }
    for (v, s) in zip([0.0, 0.21, 1], ["0%", "21%", "100%"]) { XCTAssertEqual(tenValueText(.res, v), s); XCTAssertEqual(tenValueText(.fm, v), s) }
    for (v, s) in zip([0.05, 0.35, 3.7, 12.34], ["0.05 Hz", "0.35 Hz", "3.70 Hz", "12.3 Hz"]) { XCTAssertEqual(tenValueText(.beat, v), s) }
    for (v, s) in zip([0.5, 0.2, 0.9, 0.52], ["off", "−62 Hz", "+306 Hz", "+0.0 Hz"]) { XCTAssertEqual(tenValueText(.shift, v), s) }
    for (v, s) in zip([0.0, 1, 0.5, 1.8, 0.05, 1.05], ["off", "0 dB", "−6.0 dB", "+5.1 dB", "−26.0 dB", "+0.4 dB"]) { XCTAssertEqual(tenValueText(.amp, v), s) }
  }

  func testCodes() {
    XCTAssertEqual([Act.spawn, Act.grab, Act.letGo, Act.keep, Act.unkeep, Act.move, Act.sun, Act.set, Act.pin], Array(16...24))
    XCTAssertEqual([Act.attack, Act.release, Act.link, Act.linkDepth, Act.linkType, Act.unlink, Act.setLfo, Act.setFx, Act.dice, Act.wipe], [26, 27, 28, 29, 30, 31, 32, 33, 34, 35])
    XCTAssertEqual(LfoKey.fm.rawValue, 7); XCTAssertEqual(LfoKey.pitch.rawValue, 0)
    XCTAssertEqual(Ten.head + Ten.voiceN * Ten.voices, Ten.mirrorN); XCTAssertEqual(Ten.mirrorN + Ten.scopeN * Ten.voices, Ten.mirrorFull)
  }
}
