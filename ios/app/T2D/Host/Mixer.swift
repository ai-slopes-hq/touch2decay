import UIKit

// микшер: строка на мир (номер, имя, фейдер с уровнем, mute), ниже — мастер. Порт host/mixer.js:
// геометрия, попадания, рисование. Значения держит Host (Mix); здесь только картинка и разбор касания.
enum Mixer {
  struct Geo {
    var x: CGFloat, w: CGFloat, top: CGFloat, h: CGFloat, rh: CGFloat
    var rows: [(slot: Int, y: CGFloat)]
    var my: CGFloat
    var mr: [(m: MixM, y: CGFloat)]
    var tx0: CGFloat, tx1: CGFloat, mx: CGFloat
  }

  enum Key: Hashable { case world(Int), master(MixM) }
  enum Hit: Equatable { case back, mute(Int), fader(Key), none }

  // mixGeo: коробка по центру, под scope (top + 40), строки миров по возрастанию слота, дальше мастер
  static func geo(W: CGFloat, H: CGFloat, top scopeY: CGFloat, safeBot: CGFloat) -> Geo {
    let ws = Worlds.all.map(\.slot).sorted(), w = min(420, W - 20), x = W / 2 - w / 2, top = scopeY + 40, bot = H - safeBot - 10
    let ms = MixM.allCases, avail = bot - top - 44 - 30 - 8
    let rh = min(max(avail / CGFloat(ws.count + ms.count), 24), 36)
    let rows = ws.enumerated().map { (slot: $1, y: top + 44 + CGFloat($0) * rh + rh / 2) }
    let my = top + 44 + CGFloat(ws.count) * rh + 22
    let mr = ms.enumerated().map { (m: $1, y: my + 8 + CGFloat($0) * rh + rh / 2) }
    let h = my + 8 + CGFloat(ms.count) * rh + 10 - top
    return Geo(x: x, w: w, top: top, h: h, rh: rh, rows: rows, my: my, mr: mr, tx0: x + 136, tx1: x + w - 58, mx: x + w - 26)
  }

  // mixDown: мимо коробки или «‹ concordia» — назад; строка по |y − y_строки| < rh/2;
  // у мира правее tx1 + 28 — mute; левее tx0 − 70 — ничего; иначе — фейдер
  static func hit(_ g: Geo, x: CGFloat, y: CGFloat) -> Hit {
    if x < g.x || x > g.x + g.w || y < g.top || y > g.top + g.h || (y < g.top + 34 && x < g.x + 110) { return .back }
    let half = g.rh / 2
    var key: Key?
    if let r = g.rows.first(where: { abs(y - $0.y) < half }) {
      if x > g.tx1 + 28 { return .mute(r.slot) }
      key = .world(r.slot)
    } else if let r = g.mr.first(where: { abs(y - $0.y) < half }) { key = .master(r.m) }
    guard let k = key, x >= g.tx0 - 70 else { return .none }
    return .fader(k)
  }

  // mixMove: положение ручки — база на касании + сдвиг пальца по дорожке, зажато в 0…1
  static func value(_ g: Geo, v0: Double, dx: CGFloat) -> Double { min(max(v0 + Double(dx / (g.tx1 - g.tx0)), 0), 1) }

  // уровень канала → доля полосы: −48…+6 дБ
  private static func levelK(_ lvl: Float) -> CGFloat { min(max((20 * CGFloat(log10(lvl)) + 48) / 54, 0), 1) }

  static func draw(_ d: Draw, _ M: Geo, mix: Mix, lv: [Float]) {
    d.reading {
      let g = d.g, x = M.x, w = M.w, top = M.top, tx0 = M.tx0, tx1 = M.tx1, L = tx1 - tx0
      g.setFillColor(d.paper(0.96)); g.fill(CGRect(x: x, y: top, width: w, height: M.h))
      d.hairBox(x, top, w, M.h, 0.6); d.hairBox(x + 3, top + 3, w - 6, M.h - 6, 0.25)
      d.mapText("mixer", x + w / 2, top + 20, 16, 0.9, align: .center); d.mapText("‹ concordia", x + 14, top + 20, 11, 0.5)
      // дорожка: двойная линия, засечка нуля, уровень — светлая полоса, ручка — черта
      func fader(_ y: CGFloat, _ t: Double, _ lvl: Float, _ on: Bool) {
        g.setStrokeColor(d.ink(0.3)); g.setLineWidth(1); g.beginPath()
        g.move(to: CGPoint(x: tx0, y: y - 1.5)); g.addLine(to: CGPoint(x: tx1, y: y - 1.5))
        g.move(to: CGPoint(x: tx0, y: y + 1.5)); g.addLine(to: CGPoint(x: tx1, y: y + 1.5)); g.strokePath()
        if lvl > 0.001 { let k = levelK(lvl); g.setFillColor(d.ink(0.28 + 0.4 * k)); g.fill(CGRect(x: tx0, y: y - 1, width: L * k, height: 2)) }
        let z = tx0 + L * CGFloat(Mix.faderDef)
        g.setStrokeColor(d.ink(0.35)); g.beginPath()
        g.move(to: CGPoint(x: z, y: y - 6)); g.addLine(to: CGPoint(x: z, y: y - 3)); g.move(to: CGPoint(x: z, y: y + 3)); g.addLine(to: CGPoint(x: z, y: y + 6)); g.strokePath()
        let hx = tx0 + L * CGFloat(t)
        g.setStrokeColor(d.ink(on ? 0.95 : 0.35)); g.setLineWidth(2); g.beginPath()
        g.move(to: CGPoint(x: hx, y: y - 8)); g.addLine(to: CGPoint(x: hx, y: y + 8)); g.strokePath(); g.setLineWidth(1)
      }
      let sz: CGFloat = M.rh > 30 ? 13 : 12
      for r in M.rows {
        guard let wd = Worlds.info(r.slot) else { continue }
        let m = mix.mute[r.slot] == true, t = mix.fader(r.slot), lvl = r.slot < lv.count ? lv[r.slot] : 0
        d.mapText(wd.roman, x + 14, r.y, sz - 1, 0.5); d.mapText(wd.title, x + 42, r.y, sz, m ? 0.35 : 0.85)
        fader(r.y, t, m ? 0 : lvl, !m)
        d.mapText(Mix.faderText(t), tx1 + 6, r.y, 10, 0.5)
        d.ring(M.mx, r.y, 8, m ? 0.9 : 0.4, 1)                // mute: зачёркнутый кружок
        if m {
          g.setStrokeColor(d.ink(0.9)); g.beginPath()
          g.move(to: CGPoint(x: M.mx - 5.5, y: r.y + 5.5)); g.addLine(to: CGPoint(x: M.mx + 5.5, y: r.y - 5.5)); g.strokePath()
        } else if lvl > 0.003 { d.dot(M.mx, r.y, 2 + 2.5 * min(max(CGFloat(lvl) * 6, 0), 1), 0.7) }
      }
      g.setStrokeColor(d.ink(0.3)); g.beginPath()
      g.move(to: CGPoint(x: x + 14, y: M.my - 4)); g.addLine(to: CGPoint(x: x + w - 14, y: M.my - 4)); g.strokePath()
      d.mapText("master", x + w / 2, M.my + 6, 12, 0.6, align: .center)
      for r in M.mr {
        d.mapText(r.m.label, x + 14, r.y, 12, 0.85); fader(r.y, mix[r.m], 0, true); d.mapText(r.m.text(mix[r.m]), tx1 + 6, r.y, 10, 0.55)
      }
    }
  }
}
