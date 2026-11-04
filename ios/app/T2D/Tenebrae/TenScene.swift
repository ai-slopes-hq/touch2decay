import UIKit

// Tenebrae — кеши неподвижной картинки: звёзды, рамка, меридианы, край дыры (resize, app.js:1003-1062; bgLayer :1713),
// орбиты (orbitLayer :1684, engraved :1658). В кадре — один блит `bg`.

final class TenLayers {
  private(set) var scan: CGImage?
  private(set) var orbits: CGImage?
  private(set) var bg: CGImage?
  private(set) var scanBuilds = 0, orbitBuilds = 0
  private(set) var stars: [(x: Double, y: Double)] = []        // яркие звёзды: мерцание chaos
  // ключи — поля, без String в кадре
  private var sKey: [Double] = []
  private var oKey: [Double] = []
  private var oPcs: [Int]? = nil
  private var lastOrbit = -1.0
  static let orbitStep = 1.0 / 15                                  // не чаще 15 пересборок орбит в секунду при щипке

  func update(_ v: TenebraeView, dpr: CGFloat, now: Double) {
    let dpr = min(dpr, 2), G = v.geo, d = Double(dpr)
    let sk = [G.W, G.H, d, G.top, G.bot]
    var force = false
    if sk != sKey { sKey = sk; buildScan(v, dpr); scanBuilds += 1; force = true }
    let ok = [Double(tenInt(v.zoom * 1e4)), Double(v.sclRoot), G.W, G.H, d, G.top, G.bot]
    if force || orbits == nil || ok != oKey || v.sclPcs != oPcs {
      if !force && orbits != nil && now - lastOrbit < TenLayers.orbitStep && now >= lastOrbit { return }   // грязно: соберём позже
      oKey = ok; oPcs = v.sclPcs; lastOrbit = now
      buildOrbits(v, dpr); orbitBuilds += 1
      buildBg(v, dpr)
    }
  }

  // ---------- звёзды, созвездия, меридианы, рамка ----------
  private func buildScan(_ v: TenebraeView, _ dpr: CGFloat) {
    let G = v.geo, W = G.W, ft = G.top, fb = G.bot
    var lcg = NatLCG(); lcg.seed = 7
    var bright: [(x: Double, y: Double)] = []
    scan = Draw.layer(CGSize(width: W, height: G.H), dpr) { g in
      let p = NatPen(g: g, inkC: v.theme.ink, papC: v.theme.paper)
      p.fill((r: v.theme.bg.rgb.r, g: v.theme.bg.rgb.g, b: v.theme.bg.rgb.b), 1); p.fillRect(0, 0, W, G.H)
      let n = tenInt(Horo.jsRound(W * (fb - ft) / 140))
      for _ in 0..<max(0, n) {
        let px = lcg.next() * W, py = ft + lcg.next() * (fb - ft), up = G.unplace(px, py, zoom: v.zoom).c
        if lcg.next() > up * up * 0.9 + 0.04 { continue }
        if lcg.next() < 0.035 { bright.append((px, py)); continue }
        p.fillInk(0.05 + 0.1 * lcg.next() * up)
        p.fillRect(px, py, 1.1, 1.1)
      }
      // созвездия: яркая звезда — к ближайшей соседке, если та недалеко
      p.strokeInk(0.07); g.setLineWidth(0.8)
      p.begin()
      for (i, a) in bright.enumerated() {
        var best = -1, bd = 78.0
        for (j, b) in bright.enumerated() {
          let dd = hypot(a.x - b.x, a.y - b.y)
          if j != i && dd < bd && dd > 14 { bd = dd; best = j }
        }
        if best >= 0 { p.move(a.x, a.y); p.to(bright[best].x, bright[best].y) }
      }
      p.stroke()
      for st in bright {                                           // звёздочка-гравюра: четыре луча и точка
        let l = 2 + lcg.next() * 2.2, al = 0.25 + 0.3 * lcg.next()
        p.strokeInk(al); g.setLineWidth(0.8)
        p.begin(); p.move(st.x - l, st.y); p.to(st.x + l, st.y); p.move(st.x, st.y - l); p.to(st.x, st.y + l); p.stroke()
        p.fillInk(al + 0.2); p.fillRect(st.x - 0.7, st.y - 0.7, 1.4, 1.4)
      }
      g.saveGState()
      g.clip(to: CGRect(x: 0, y: ft, width: W, height: fb - ft))
      p.dash([1, 6]); p.strokeInk(0.09); g.setLineWidth(1)          // меридианы через 15°
      let R = hypot(W, fb - ft) + 10
      for deg in stride(from: 15, to: 90, by: 15) {
        let t = Double(deg) * .pi / 180
        p.begin(); p.move(G.ox + cos(t) * 46, G.oy - sin(t) * 46); p.to(G.ox + cos(t) * R, G.oy - sin(t) * R); p.stroke()
      }
      g.restoreGState()
      p.dash([])
      p.strokeInk(0.16); g.setLineWidth(1); p.strokeRect(4.5, ft + 0.5, W - 9, fb - ft - 1)
      p.strokeInk(0.07); p.strokeRect(8.5, ft + 4.5, W - 17, fb - ft - 9)
      p.strokeInk(0.14)
      p.begin()
      var i = 0, px = 12.0
      while px < W - 10 { let l = i % 5 != 0 ? 2.5 : 4.5; p.move(Horo.jsRound(px) + 0.5, ft + 4.5); p.to(Horo.jsRound(px) + 0.5, ft + 4.5 + l); px += 8; i += 1 }
      i = 0; var py = ft + 12
      while py < fb - 6 { let l = i % 5 != 0 ? 2.5 : 4.5; p.move(W - 8.5, Horo.jsRound(py) + 0.5); p.to(W - 8.5 - l, Horo.jsRound(py) + 0.5); py += 8; i += 1 }
      p.stroke()
    }
    stars = bright
  }

  // ---------- орбиты ----------
  // гравированная орбита: двойная линия и засечки по внешней (engraved, app.js:1658)
  private func engraved(_ p: NatPen, _ G: TenGeo, _ r: Double, _ a: Double) {
    let q = -Double.pi / 2
    p.strokeInk(a); p.g.setLineWidth(1)
    p.begin(); p.arc(G.ox, G.oy, r, q, 0); p.stroke()
    p.strokeInk(a * 0.5)
    p.begin(); p.arc(G.ox, G.oy, r + 2.5, q, 0); p.stroke()
    p.strokeInk(a * 0.8)
    p.begin()
    var deg = 1.5
    while deg < 90 {
      let t = deg * .pi / 180, c = cos(t), s = sin(t)
      p.move(G.ox + c * (r + 2.5), G.oy - s * (r + 2.5)); p.to(G.ox + c * (r + 5), G.oy - s * (r + 5))
      deg += 3
    }
    p.stroke()
  }

  private func buildOrbits(_ v: TenebraeView, _ dpr: CGFloat) {
    let G = v.geo, cols = v.fieldCols()
    orbits = Draw.layer(CGSize(width: G.W, height: G.H), dpr) { g in
      let p = NatPen(g: g, inkC: v.theme.ink, papC: v.theme.paper)
      g.clip(to: CGRect(x: 0, y: G.top, width: G.W, height: G.bot - G.top))
      for (i, c) in cols.enumerated() where i > 0 && c.r0 < 1e5 { engraved(p, G, c.r0, 0.12) }
      if let pcs = v.sclPcs {
        let q = -Double.pi / 2
        for n in 0...Int(Ten.semis) {                              // ноты лада — пунктирные орбиты, тоники — гравированные
          if !pcs.contains(((n % 12) + 12) % 12) { continue }
          let rn = G.rAt(tenXOf(Double(n)), zoom: v.zoom)
          if rn == .infinity { break }
          if (((n - v.sclRoot) % 12) + 12) % 12 == 0 { p.dash([]); engraved(p, G, rn, 0.16); continue }
          p.dash([1, 5]); p.strokeInk(0.16); g.setLineWidth(1)
          p.begin(); p.arc(G.ox, G.oy, rn, q, 0); p.stroke()
        }
      }
    }
  }

  // ---------- фон кадра: чёрный, звёзды, орбиты, край дыры ----------
  private func buildBg(_ v: TenebraeView, _ dpr: CGFloat) {
    let G = v.geo, W = G.W, th = v.theme
    bg = Draw.layer(CGSize(width: W, height: G.H), dpr) { g in
      let p = NatPen(g: g, inkC: th.ink, papC: th.paper)
      let bgc = th.bg.rgb
      p.fill((r: bgc.r, g: bgc.g, b: bgc.b), 1); p.fillRect(0, 0, W, G.H)
      for img in [scan, orbits] {
        guard let img else { continue }
        g.saveGState(); g.translateBy(x: 0, y: G.H); g.scaleBy(x: 1, y: -1)
        g.draw(img, in: CGRect(x: 0, y: 0, width: W, height: G.H)); g.restoreGState()
      }
      // краешек дыры: свет слабо тает вдоль шумного края поля, на границе — едва видный пунктир
      let ex = Ten.edge + 16, ey = G.top + Ten.edgeT + 16, sy = G.oy - Ten.sunR
      let pc = th.paper
      let comps: [CGFloat] = [pc.r / 255, pc.g / 255, pc.b / 255, 0.7, pc.r / 255, pc.g / 255, pc.b / 255, 0]
      if let gr = CGGradient(colorSpace: CGColorSpaceCreateDeviceRGB(), colorComponents: comps, locations: [0, 1], count: 2) {
        if sy > ey {
          g.saveGState(); g.clip(to: CGRect(x: 0, y: ey, width: ex, height: sy - ey))
          g.drawLinearGradient(gr, start: CGPoint(x: 0, y: 0), end: CGPoint(x: ex, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
          g.restoreGState()
        }
        g.saveGState(); g.clip(to: CGRect(x: 0, y: G.top, width: W, height: ey - G.top))
        g.drawLinearGradient(gr, start: CGPoint(x: 0, y: G.top), end: CGPoint(x: 0, y: ey), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
        g.restoreGState()
      }
      p.dash([1, 5]); p.strokeInk(0.14); g.setLineWidth(1)
      p.begin(); p.move(Ten.edge, sy); p.to(Ten.edge, G.top + Ten.edgeT); p.to(W, G.top + Ten.edgeT); p.stroke()
      p.dash([])
    }
  }
}

private extension UIColor {
  var rgb: (r: CGFloat, g: CGFloat, b: CGFloat) {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    return (r * 255, g * 255, b * 255)
  }
}
