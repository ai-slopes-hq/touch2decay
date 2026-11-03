import UIKit

// Cymatica — кеш неподвижного фона: волны из двух углов (view.js:624-648)

// view.js:628 — шаг кругов: длина волны основного тона пластины (больше пластина, ниже звук — реже)
func cymWaveStep(_ fsRound: Int) -> Double { 24 * pow(Cym.fMin * pow(2, Double(fsRound) / 12) / 110, -1.0 / 3) }

final class CymWaves {
  private(set) var builds = 0
  private(set) var img: CGImage?
  // ключ веба `W×H×DPR|round(fs)|topY|safeBot` — поля, без String в кадре
  private var built = false
  private var kW = 0.0, kH = 0.0, kD = 0.0, kFs = 0, kTop = 0.0, kBot = 0.0

  func update(W: Double, H: Double, dpr: CGFloat, fs: Double, topY: Double, safeBot: Double, ink: RGB, bg: RGB) {
    let d = Double(dpr), f = Int(Horo.jsRound(fs))
    if built && W == kW && H == kH && d == kD && f == kFs && topY == kTop && safeBot == kBot { return }
    built = true; kW = W; kH = H; kD = d; kFs = f; kTop = topY; kBot = safeBot
    builds += 1
    let step = cymWaveStep(f), far = hypot(W, H)
    img = Draw.layer(CGSize(width: W, height: H), dpr) { g in
      let p = NatPen(g: g, inkC: ink, papC: bg)
      p.fillPap(1); p.fillRect(0, 0, W, H)
      p.strokeInk(0.045); g.setLineWidth(0.8)
      for (sx, sy) in [(W, H - safeBot), (0, topY)] {            // один путь и один stroke на источник
        p.begin()
        var r = step
        while r < far { p.move(sx + r, sy); p.arc(sx, sy, r, 0, .pi * 2); r += step }
        p.stroke()
      }
    }
  }
}
