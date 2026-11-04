import UIKit

// Tenebrae: кадр целиком в порядке веба (solDraw, app.js:1906-1979; решение 16): фон одним блитом, поле, волны, призрак, нити,
// планеты, удержание, отказ, мост, кольцо связи, чип close. Кадр состояния не меняет: всё накопленное считает tick

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { x.isNaN ? a : min(b, max(a, x)) }
private func invLog(_ lo: Double, _ hi: Double, _ v: Double) -> Double { log(max(v, lo) / lo) / log(hi / lo) }

extension TenebraeView {
  func draw(_ d: Draw, now: Double) { drawFrame(d, now: now) }
  func drawShot(_ d: Draw, now: Double) { drawFrame(d, now: now) }

  func drawFrame(_ d: Draw, now: Double) {
    let nowMs = now * 1000
    let p = NatPen(g: d.g, inkC: theme.ink, papC: theme.paper)
    layers.update(self, dpr: Draw.scale, now: now)
    d.blit(layers.bg)
    drawField(p, d, now: now)
    drawWaves(d)
    if !touchedOnce { drawGhostCircle(d, nowMs: nowMs) }
    drawLinks(p, d, nowMs: nowMs)
    for i in 0..<Ten.voices where voice(i).active {
      if let br = bridge, br.a == i || br.b == i { continue }
      drawVoice(p, d, i, nowMs: nowMs)
    }
    drawHold(p, now: now)
    drawRefusals(d, now: now)
    if bridge != nil { drawBridge(p, d, nowMs: nowMs) }
    let pinned = ring?.pinned ?? false
    if let r = ring, r.pinned, sheetVoice == nil { drawRingPinned(p, d, r) }
    if let g = ghost, now <= g.until, !pinned {                // погасшее кольцо: один слой с общей альфой, булавку ещё можно тапнуть
      let a = 0.85 * pow(clamp((g.until - now) / Ten.ghost), 0.6)
      d.g.saveGState(); d.g.setAlpha(CGFloat(a)); d.g.beginTransparencyLayer(auxiliaryInfo: nil)
      drawRingHung(p, d, g.ring)
      d.g.endTransparencyLayer(); d.g.restoreGState()
    }
    if let r = ring, !r.pinned { drawRingHung(p, d, r) }
    if sheetVoice != nil, let i = sheetVoice, voice(i).active { drawSheet(p, d, nowMs: nowMs); return }   // плашка открыта — после неё ничего (:1975)
    if pinned && sheetVoice == nil { drawCloseChip(d) }
  }

  // ---------- поле (drawField :1738) ----------
  private func drawField(_ p: NatPen, _ d: Draw, now: Double) {
    let G = geo, nowMs = now * 1000
    var held: [Int] = []
    for f in fingers.values {
      if let v = f.v, !f.wasBridge, !f.opened, (0..<Ten.voices).contains(v), voice(v).active, !held.contains(v) { held.append(v) }
    }
    let drag = !held.isEmpty
    let zk = clamp((zoomShow - now) / 0.4)                       // зум: 1 — пока щиплешь, дальше тает
    let heldS = held.map { tenSemi(soundX(voice($0))) }
    let needCols = drag || zk > 0
    let cols = needCols ? fieldCols() : []
    let Q = -Double.pi / 2
    let g = p.g
    g.saveGState()
    g.clip(to: CGRect(x: 0, y: G.top, width: G.W, height: G.bot - G.top))
    drawSun(p, d, nowMs: nowMs)
    drawHole(p, nowMs: nowMs)
    let chaos = clamp(fxValues[3])
    if chaos > 0.02 && !layers.stars.isEmpty {                   // chaos — звёзды мерцают
      let n = tenInt((chaos * 14).rounded()), cnt = layers.stars.count
      for k in 0..<n {
        let idx = min(cnt - 1, tenInt(tenHash(Double(k), nowMs) * Double(cnt)))
        let st = layers.stars[max(0, idx)]
        d.dot(st.x, st.y, 1 + tenHash(Double(k) + 50, nowMs) * 1.4, tenHash(Double(k) + 100, nowMs) * 0.7 * chaos + 0.1)
      }
    }
    for c in cols where heldS.contains(where: { $0 >= c.s0 && $0 < c.s1 + (c.s1 >= Ten.semis ? 1 : 0) }) {   // полоса под кружком — едва светлее
      p.fillInk(0.045)
      p.begin(); p.arc(G.ox, G.oy, c.r1, Q, 0); p.arc(G.ox, G.oy, c.r0, 0, Q, ccw: true); p.close(); p.fill()
    }
    let boost = drag ? 0.8 : 1.5 * zk                            // орбиты уже в фоне; при перетаскивании и зуме — ещё раз, ярче
    if boost > 0.02 {
      g.saveGState(); g.setAlpha(CGFloat(min(1, boost))); d.blit(layers.orbits); g.restoreGState()
    }
    var tgt: [(n: Int, v: Int)] = []                             // нота, к которой притянут кружок
    if sclOn {
      for (k, v) in held.enumerated() {
        let n = tenInt(heldS[k].rounded())
        if !tgt.contains(where: { $0.n == n }) { tgt.append((n, v)) }
      }
      for t in tgt where inScale(t.n) {
        let rn = G.rAt(tenXOf(Double(t.n)), zoom: zoom)
        if !rn.isFinite { continue }
        p.line(0.7, 1.4); p.begin(); p.arc(G.ox, G.oy, rn, Q, 0); p.stroke()
      }
    }
    g.restoreGState()
    if zk > 0 {
      let hz = Ten.fLo * pow(2, tenSemi(zoom) / 12)
      let s = hz >= 1000 ? String(format: "%.2f", hz / 1000) + " kHz" : "\(tenInt(Horo.jsRound(hz))) Hz"
      d.mapText("55 – " + s, G.W / 2, G.top + 76, 17, 0.9 * zk, align: .center)
    }
    if !drag && zk <= 0 { return }
    let la = drag ? 1.0 : zk                                     // подписи — при перетаскивании или при зуме
    for c in cols {
      let on = heldS.contains { $0 >= c.s0 && $0 < c.s1 + (c.s1 >= Ten.semis ? 1 : 0) }
      let rm = c.s1 >= Ten.semis ? (c.r0 + min(c.r1, hypot(G.W, G.bot - G.top))) / 2 : (c.r0 + c.r1) / 2
      if !c.label.isEmpty && c.r1 - c.r0 > 16 {
        let e = G.arcEnds(rm).clean
        let lab = sclOn ? c.label : c.label.prefix(1).uppercased() + c.label.dropFirst()
        let al = on ? 0.95 : drag ? 0.5 : 0.85 * la
        if e.y >= G.bot - 1 { d.mapText(lab, e.x, G.bot - 13, 15, al, align: .center) }
        else { d.mapText(lab, G.W - 14, e.y, 15, al, align: .right) }
      }
      if c.hz > 0 {
        let e = G.arcEnds(c.r0).noisy
        let k = c.hz / 1000
        let s = c.hz >= 1000 ? (k == k.rounded() ? "\(tenInt(k))k" : "\(k)k") : "\(tenInt(c.hz))"
        d.mapText(s, e.x + 12, e.x < 1 ? e.y - 9 : G.top + Ten.edgeT - 4, 12, drag ? 0.5 : 0.75 * la)
      }
    }
    for t in tgt where inScale(t.n) {                            // в ладу — имя ноты рядом с кружком, снаружи по радиусу
      let pt = G.place(tenXOf(Double(t.n)), voice(t.v).y, zoom: zoom), a = atan2(pt.y - G.oy, pt.x - G.ox)
      d.mapText(tenNoteName(t.n), clamp(pt.x + cos(a) * 54, 18, G.W - 18), clamp(pt.y + sin(a) * 54, G.top + 12, G.bot - 12), 17, 1, align: .center)
    }
  }

  private func inScale(_ n: Int) -> Bool { sclPcs?.contains(((n % 12) + 12) % 12) ?? false }

  // ---------- волны (:1911-1936): шаг и рождение — в tick ----------
  private func drawWaves(_ d: Draw) {
    let f = fxValues
    let rmax = hypot(area.W, area.H) * (0.3 + 0.35 * clamp(f[0]) + 0.35 * clamp(invLog(0.6, 14, f[1])))
    if !(rmax > 0) { return }
    for w in waves where w.wait <= 0 {
      let al = min(1, w.a * 0.28 * pow(max(0, 1 - w.r / rmax), 1.6))
      if !(al > 0.001) { continue }
      if w.dash {
        d.g.saveGState(); d.g.setLineDash(phase: 0, lengths: [2, 5]); d.ring(w.x, w.y, w.r, al, 1); d.g.restoreGState()
      } else { d.ring(w.x, w.y, w.r, al, 1) }
    }
  }

  // до первого касания — призрак кружка (:1938)
  private func drawGhostCircle(_ d: Draw, nowMs: Double) {
    let x = area.W * 0.35, y = area.H * 0.6
    let breathe = 0.5 + 0.5 * sin(nowMs / 900)
    for (r, a) in [(62.0, 0.12), (98, 0.07), (146, 0.035)] { d.ring(x, y, r + breathe * 6, a, 1) }
    d.ring(x, y, 34, 0.25 + 0.2 * breathe, 1.4)
  }

  // ---------- удержание (:1808) и отказ (:1962) ----------
  private func drawHold(_ p: NatPen, now: Double) {
    guard let h = hold, let f = fingers[h.id], f.caught, !f.moved, !f.opened, !f.wasBridge, let v = f.v,
          (0..<Ten.voices).contains(v), voice(v).active else { return }
    let k = (now - h.t0) / Ten.hold
    if !(k >= 0.15 && k < 1) { return }
    let pos = screenPos(v)
    p.line(0.85, 2)
    p.begin(); p.arc(pos.x, pos.y, 46, -.pi / 2, -.pi / 2 + (k - 0.15) / 0.85 * 2 * .pi); p.stroke()
  }

  private func drawRefusals(_ d: Draw, now: Double) {
    func mark(_ x: Double, _ y: Double, _ t: Double) {
      let k = (now - t) / 0.6
      if !(k >= 0 && k < 1) { return }
      d.g.saveGState(); d.g.setLineDash(phase: 0, lengths: [3, 5])
      d.ring(x, y, 34 * (1 - 0.4 * k), 0.7 * (1 - k), 1.2)
      d.g.restoreGState()
    }
    for f in full { mark(f.x, f.y, f.t) }
    if let r = refuse { mark(r.x, r.y, r.t0) }
  }

  // ---------- нити связей (:1220) ----------
  func drawLinks(_ p: NatPen, _ d: Draw, nowMs: Double) {
    let g = p.g
    g.saveGState()
    for dst in 0..<Ten.voices {
      let v = voice(dst)
      if !v.active { continue }
      for m in v.mods {
        guard (0..<Ten.voices).contains(m.src), (0..<Ten.linkTypes.count).contains(m.type) else { continue }
        let s = voice(m.src)
        if !s.active { continue }
        if let br = bridge, br.a == dst, br.b == m.src { continue }
        let depth = clamp(m.depth), k = m.auto ? 0.45 : 1.0
        let ed = ring.map { $0.pinned && $0.dst == dst && $0.src == m.src } ?? false
        let cutting = ed && (ring?.cutting ?? false)
        let a = (0.15 + 0.55 * min(1, clamp(s.env, 0, 10) * 1.2)) * (0.4 + 0.6 * depth) * k
        let c = linkCurve(dst: dst, src: m.src)
        let pat = Ten.linkDash[m.type], per = pat.reduce(0, +)
        let ph = per > 0 ? CGFloat(((-nowMs * 0.02).truncatingRemainder(dividingBy: Double(per)) + Double(per)).truncatingRemainder(dividingBy: Double(per))) : 0
        g.setLineDash(phase: ph, lengths: pat)
        p.line(cutting ? 0.12 : ed ? 0.9 : a, ed ? 1.5 : 1)
        p.begin(); p.move(c.x0, c.y0); p.quad(c.cx, c.cy, c.x1, c.y1); p.stroke()
        g.setLineDash(phase: 0, lengths: [])
        // поток частиц: глубже — гуще, выше источник — быстрее; у концов тают
        let n = 2 + tenInt((4 * depth).rounded()), sp = 0.18 + 0.12 * log2(max(1e-9, tenFreq(soundX(s))) / Ten.fLo)
        let phase = nowMs / 1000 * sp
        for i in 0..<n {
          let t = (phase + Double(i) / Double(n)).truncatingRemainder(dividingBy: 1), q = tenBez(c, t), fade = sin(.pi * t)
          d.dot(q.x, q.y, 1.2 + 1.6 * depth * fade, min(1, a * 1.6) * fade)
        }
        if !m.auto {
          let mid = tenBez(c, 0.5)
          d.diamond(mid.x, mid.y, 5, ed ? 1 : 0.7, ed)
          d.text(Ten.linkTypes[m.type], mid.x + 10, mid.y - 9, 10, 0.5)
        }
      }
    }
    g.restoreGState()
  }

  // ---------- мост (:1179): двойная спираль между пальцами ----------
  func drawBridge(_ p: NatPen, _ d: Draw, nowMs: Double) {
    guard let br = bridge, let fa = fingers[br.fa], let fb = fingers[br.fb], let bm = linkMod(br.a, br.b),
          (0..<Ten.linkTypes.count).contains(bm.type) else { return }
    let dx = fb.x - fa.x, dy = fb.y - fa.y, L = max(hypot(dx, dy), 1e-9)
    let nx = -dy / L, ny = dx / L, depth = clamp(bm.depth)
    let amp = 3 + depth * 16, waves = 1.5 + L / 70
    let ph = nowMs / 1000 * (1.5 + tenFreq(soundX(voice(br.b))) / 120) * 2 * .pi
    let N = 120
    func off(_ i: Int) -> Double { let t = Double(i) / Double(N); return amp * sin(t * .pi) * sin(t * waves * .pi * 2 - ph) }
    func at(_ i: Int, _ sg: Double) -> (x: Double, y: Double) {
      let t = Double(i) / Double(N), o = off(i) * sg
      return (fa.x + dx * t + nx * o, fa.y + dy * t + ny * o)
    }
    p.line(0.25, 1)
    p.begin()
    var i = 4
    while i < N { let a = at(i, 1), b = at(i, -1); p.move(a.x, a.y); p.to(b.x, b.y); i += 5 }
    p.stroke()
    for sg in [1.0, -1.0] {
      p.line(0.8, 1.2); p.begin()
      for j in 0...N { let q = at(j, sg); if j > 0 { p.to(q.x, q.y) } else { p.move(q.x, q.y) } }
      p.stroke()
    }
    // кружки стоят на месте; если палец уехал — тонкая нить от кружка к пальцу
    for (v, f) in [(br.a, fa), (br.b, fb)] {
      let pos = screenPos(v)
      contour(p, v, x: pos.x, y: pos.y, R: 34, a: 1, lw: 2, glow: true)
      if hypot(f.x - pos.x, f.y - pos.y) > 24 {
        p.line(0.3, 1); p.begin(); p.move(pos.x, pos.y); p.to(f.x, f.y); p.stroke()
      }
      d.dot(f.x, f.y, 3, 1)
    }
    d.text(Ten.linkTypes[bm.type], (fa.x + fb.x) / 2, (fa.y + fb.y) / 2 - 18, 11, 0.6, align: .center)
  }
}
