import UIKit

private let tau = 2 * Double.pi
private let dashDots: [CGFloat] = [1.5, 2.5]                  // пунктир шанса и орбиты луны, один на кадр не собирается

// порт worlds/cymatica/view.js:459-580 — астролябия: кольца гнёзд, лимбы, бусины, стрелки, кнопки, луна, подписи.
// Время now — секунды (в вебе мс: мигание 0.22, горячая метка 0.16). Кадр ничего не меняет в state, fingers, pair.
extension CymaticaView {
  func drawAstro(_ p: NatPen, _ d: Draw, now: Double) {
    let g = geo, A = g, grid = max(1, self.grid), sr = stepRec
    let stepS = 60 / max(1, bpm) / 4
    let rl = rlen, ml = mlen
    let b = base(), nd = scl.degPerOct                          // один раз на кадр, не на бусину
    let cx = CGFloat(g.cx), cy = CGFloat(g.cy)
    for R in [A.R1, A.R2] { d.ring(cx, cy, CGFloat(R), 0.6, 1.1); d.ring(cx, cy, CGFloat(R + 2.5), 0.2, 1) }
    p.g.setLineWidth(1)
    let tr = ringTurn[0] * Double.pi / 180, tm = ringTurn[1] * Double.pi / 180
    limbs(p, g)
    lengthFills(p, d, g, rl: rl, ml: ml, tr: tr, tm: tm)
    // ритм: удар — крупная точка, пустое гнездо — колечко; мелодия — название ноты у гнезда, пусто — «·»
    for i in 0..<Cym.slots {
      var a = CymGeo.slotAng(i) + tr, x = cos(a), y = sin(a)
      let onR = i < rl, onM = i < ml, st = step(i), mk = mark(i)
      let lg = i % grid == 0 ? 7.0 : 4.0                      // доли сетки записи — засечки длиннее
      p.line(onR ? 0.45 : 0.12, 1)
      p.begin(); p.move(g.cx + x * (A.R2 + 8), g.cy + y * (A.R2 + 8)); p.to(g.cx + x * (A.R2 + 8 + lg), g.cy + y * (A.R2 + 8 + lg)); p.stroke()
      let rx = g.cx + x * A.R2, ry = g.cy + y * A.R2, br = blink(state.pulse.r[i], now)
      if st.on && onR {
        let ch = st.chance                                    // шанс < 100 % — точка меньше и бледнее, вокруг пунктир
        d.dot(CGFloat(rx), CGFloat(ry), CGFloat((5.5 + 3 * br) * (0.55 + 0.45 * ch)), CGFloat(0.45 + 0.55 * ch))
        if br > 0 { d.ring(CGFloat(rx), CGFloat(ry), CGFloat(10 + 6 * (1 - br)), CGFloat(br), 1.6) }
        if ch < 1 { p.g.saveGState(); p.dash(dashDots); d.ring(CGFloat(rx), CGFloat(ry), 8, 0.6, 1); p.g.restoreGState() }
      } else if onR {
        p.fillPap(1); p.begin(); p.arc(rx, ry, 3.5, 0, tau); p.fill()
        d.ring(CGFloat(rx), CGFloat(ry), 3.5, 0.6, 1.1)
      } else { d.dot(CGFloat(rx), CGFloat(ry), 1, 0.12) }     // за длиной кольца — гаснет
      flash(d, rx, ry, state.born.r[i], now: now)
      a = CymGeo.slotAng(i) + tm; x = cos(a); y = sin(a)
      let mx = g.cx + x * A.R1, my = g.cy + y * A.R1, bm = blink(state.pulse.m[i], now)
      if !onM { d.dot(CGFloat(mx), CGFloat(my), 1, 0.12) }    // за длиной кольца — гаснет, подписи нет
      else {
        p.fillPap(0.85); p.begin(); p.arc(mx, my, 11, 0, tau); p.fill()   // тёмная подложка — читается поверх волн
        if mk.on, let s = cymNoteAt(mk.x, mk.y, b: b, n: nd, list: noteList) {
          d.mapText(Cym.noteName(Cym.fMin * pow(2, Double(s) / 12)), CGFloat(mx), CGFloat(my), CGFloat(14 + 4 * bm), 1, align: .center)
        } else { d.dot(CGFloat(mx), CGFloat(my), 2, 0.6) }
        d.ring(CGFloat(mx), CGFloat(my), 11, CGFloat(0.25 + 0.75 * bm), CGFloat(1 + 0.6 * bm))
      }
      flash(d, mx, my, state.born.m[i], now: now)
    }
    let ls = state.lastStep
    if playing, let ls {                                      // стрелки: от края стола к своему кольцу, плавно между тиками
      let fr = min(1, max(0, (now - ls.t) / stepS))
      for (i, R, al) in [(ls.r, A.R2 + 6, 0.6), (ls.m, A.R1 - 12, 0.45)] {
        let ang = Double.pi * 2 * (Double(i) + fr) / Double(Cym.slots) - Double.pi / 2   // slotAng(i + fr), дробный
        p.line(al, 0.8)
        p.begin(); p.move(g.cx + cos(ang) * (g.rMax + 2), g.cy + sin(ang) * (g.rMax + 2)); p.to(g.cx + cos(ang) * R, g.cy + sin(ang) * R); p.stroke()
      }
    }
    for i in 0..<Cym.slots {                                  // метки мест мелодии на пластине; вспыхивает та, по которой бьёт удар
      let mk = mark(i)
      if !mk.on { continue }
      let q = g.fromPlate(mk.x, mk.y)
      var hot = false
      if playing, let ls, ls.m == i, step(ls.r).on, now - ls.t < 0.16 { hot = true }
      if hot { d.ring(CGFloat(q.x), CGFloat(q.y), 7, 0.9, 1.2) }
      d.dot(CGFloat(q.x), CGFloat(q.y), 2.2, i < ml ? 0.8 : 0.25)
    }
    // ▶/■ и ●
    for x in [A.playX, A.recX, A.gridX, A.driftX] {
      p.fillPap(0.88); p.begin(); p.arc(x, A.ty, 18, 0, tau); p.fill()
      d.ring(CGFloat(x), CGFloat(A.ty), 17, 0.45, 1.2)
    }
    moon(p, d, g)
    let ty = CGFloat(A.ty), dr = drift, dd = Cym.driftDepth(dr.depth)
    let cyL = ty + 30                                         // подписи под кнопками — тихо, латынью
    d.mapText("\(Int(Horo.jsRound(bpm))) bpm", CGFloat(A.playX), cyL, 12, 0.5, align: .center)
    if !sr.on { d.mapText(playing ? "scribe" : "per gradus", CGFloat(A.recX), cyL, 12, rec ? 0.85 : 0.5, align: .center) }
    d.mapText("grid", CGFloat(A.gridX), cyL, 12, 0.5, align: .center)
    d.mapText(dr.on ? "luna ±\(dd)" : "luna", CGFloat(A.driftX), cyL, 12, dr.on ? 0.75 : 0.5, align: .center)
    if sr.on {                                                // запись по шагам: курсоры на обоих кольцах, подпись
      let pr = g.slotXY(sr.r, A.R2), pm = g.slotXY(sr.m, A.R1)
      d.ring(CGFloat(pr.x), CGFloat(pr.y), 12, 0.9, 1.4); d.ring(CGFloat(pm.x), CGFloat(pm.y), 15, 0.9, 1.4)
      d.mapText("step \(sr.r + 1) · \(sr.m + 1)", CGFloat(A.recX), cyL, 13, 0.75, align: .center)
    }
    if let ce = chanceEdit, now < ce.until, step(ce.i).on {
      let q = g.slotXY(ce.i, A.R2 + 26)
      d.mapText("chance \(Int(Horo.jsRound(step(ce.i).chance * 100)))%", CGFloat(q.x), CGFloat(q.y), 13, 0.9, align: .center)
    }
    p.line(0.85, 1.2); p.begin()
    if playing { p.rect(A.playX - 5, A.ty - 5, 10, 10) }
    else { p.move(A.playX - 4, A.ty - 6); p.to(A.playX + 5, A.ty); p.to(A.playX - 4, A.ty + 6); p.close() }
    p.stroke()
    let rcx = CGFloat(A.recX)
    if rec { d.dot(rcx, ty, 5, 0.95) }
    else if sr.on { d.ring(rcx, ty, 5, 0.95, 1.4); d.dot(rcx, ty, 2, 0.95) }
    else { d.ring(rcx, ty, 5, 0.6, 1.2) }
    d.mapText(String(16 / grid), CGFloat(A.gridX), ty, 15, 0.8, align: .center)   // сетка записи: 16, 8, 4
    if now < bpmUntil { d.mapText("\(Int(Horo.jsRound(bpm))) BPM", CGFloat(A.playX), ty - 30, 14, 0.85, align: .center) }
    if let ne = noteEdit, now < ne.until {                    // тянешь засечку мелодии — гнездо обведено
      let q = g.slotXY(ne.i, A.R1)
      d.ring(CGFloat(q.x), CGFloat(q.y), 13, 0.9, 1.4)
    }
  }

  private func blink(_ t: Double, _ now: Double) -> Double { max(0, 1 - (now - t) / 0.22) }

  // view.js:465-482 — шкала лимба: 64 деления и звезда-указатель, крутятся вместе с кольцом
  private func limbs(_ p: NatPen, _ g: CymGeo) {
    let specs = [(g.R2, ringOrn[0] + ringTurn[0], 1.0), (g.R1 - 11, ringOrn[1] + ringTurn[1], -1.0)]
    for (R, o, side) in specs {
      let base = o * Double.pi / 180
      p.line(0.22, 0.8); p.begin()
      for j in 0..<64 {
        let a = base + Double(j) * Double.pi / 32, l = j % 4 != 0 ? 2.5 : 4.0
        p.move(g.cx + cos(a) * (R + side * 3), g.cy + sin(a) * (R + side * 3))
        p.to(g.cx + cos(a) * (R + side * (3 + l)), g.cy + sin(a) * (R + side * (3 + l)))
      }
      p.stroke()
      let a = base - Double.pi / 2 + Double.pi / 16 + (side < 0 ? Double.pi : 0)
      let px = g.cx + cos(a) * (R + side * 10), py = g.cy + sin(a) * (R + side * 10)
      let ux = cos(a) * 4 * side, uy = sin(a) * 4 * side, vx = -sin(a) * 2, vy = cos(a) * 2
      p.strokeInk(0.45); p.begin()
      p.move(px - ux, py - uy); p.to(px + vx, py + vy); p.to(px + ux, py + uy); p.to(px - vx, py - vy); p.close(); p.stroke()
    }
  }

  // view.js:483-492 — длина кольца: заливка от начала до края, край тянется; число длины у края
  private func lengthFills(_ p: NatPen, _ d: Draw, _ g: CymGeo, rl: Int, ml: Int, tr: Double, tm: Double) {
    let rings = [(0, g.R2, 16.0, rl, tr), (1, g.R1, 26.0, ml, tm)]
    for (ri, R, w, len, rot) in rings {
      let a0 = -Double.pi / 2 - 0.5 * Double.pi * 2 / Double(Cym.slots) + rot                  // slotAng(−0.5)
      let a1 = -Double.pi / 2 + (Double(len) - 0.5) * Double.pi * 2 / Double(Cym.slots) + rot
      var held = false
      for f in fingers.values where f.kind == .len && f.ring == ri { held = true }
      p.line(held ? 0.2 : 0.09, w)                            // рисуется до бусин и точек — под ними
      p.begin(); p.arc(g.cx, g.cy, R, a0, a1 - (len == Cym.slots ? 1e-4 : 0)); p.stroke()
      p.line(held ? 1 : 0.7, held ? 2 : 1.4)                  // край заливки — за него тянуть
      p.begin(); p.move(g.cx + cos(a1) * (R - w / 2), g.cy + sin(a1) * (R - w / 2)); p.to(g.cx + cos(a1) * (R + w / 2), g.cy + sin(a1) * (R + w / 2)); p.stroke()
      d.mapText(String(len), CGFloat(g.cx + cos(a1 + 0.09) * R), CGFloat(g.cy + sin(a1 + 0.09) * R), 12, held ? 1 : 0.6, align: .center)
    }
  }

  // view.js:542-552 — луна на орбите вокруг пластины: ширина орбиты — глубина, место и фаза — где пластина в качании
  private func moon(_ p: NatPen, _ d: Draw, _ g: CymGeo) {
    let dr = drift, x0 = g.driftX, y0 = g.ty, a = dr.on ? 0.95 : 0.45
    let ph = dr.on ? min(1, max(-1, Double(dr.k) / Double(max(1, Cym.driftDepth(dr.depth))))) : 0.6
    let ox = 6 + 8 * dr.depth, oy = ox * 0.5, r = 3.4
    p.g.saveGState(); p.dash(dashDots); p.line(a * 0.5, 1)
    p.begin(); p.ellipse(x0, y0, ox, oy, rot: 0, 0, tau); p.stroke(); p.g.restoreGState()
    d.dot(CGFloat(x0), CGFloat(y0), 1.6, CGFloat(a * 0.7))    // пластина
    let x = x0 + ph * ox, y = y0 - max(0, 1 - ph * ph).squareRoot() * oy
    p.fillPap(1); p.begin(); p.arc(x, y, r + 1.5, 0, tau); p.fill()
    d.ring(CGFloat(x), CGFloat(y), CGFloat(r), CGFloat(a), 1)
    p.fillInk(a * 0.8); p.begin(); p.arc(x, y, r, -Double.pi / 2, Double.pi / 2)
    p.ellipse(x, y, max(abs(ph) * r, 1e-3), r, rot: 0, Double.pi / 2, -Double.pi / 2, ccw: ph > 0); p.fill()   // 1e-3: нулевой масштаб CG не любит
    if dr.on && dr.shape >= 0.5 { d.dot(CGFloat(x0 - 11), CGFloat(y0 - 10), 1.2, 0.7); d.dot(CGFloat(x0 + 11), CGFloat(y0 - 10), 1.2, 0.7) }   // random — две звёздочки
  }
}
