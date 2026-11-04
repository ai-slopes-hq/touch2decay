import Foundation
import QuartzCore

// -bench: прогон карта → мир → карта по всем мирам дважды (холодный и тёплый круг) с замером кадров в лог.
// Тяжёлые кадры (рисование > 8 мс или пропуск vsync) — строкой с фазой; по каждому переходу — сводка.
final class Bench {
  static let on = CommandLine.arguments.contains("-bench")
  private let slots = Worlds.all.map(\.slot).sorted()
  private var plan: [(at: Double, act: (Host) -> String)] = []
  private var t0: Double?
  private var phase = "", n = 0, sum = 0.0, mx = 0.0, miss = 0

  init() {
    var t = 3.0
    for round in 0..<2 {
      for s in slots {
        plan.append((t, { h in h.goWorld(s); return "r\(round) in \(s)" }))
        plan.append((t + 1.6, { h in
          let a = CACurrentMediaTime(); h.goMap()
          return String(format: "r\(round) out \(s) goMap %.1f ms", (CACurrentMediaTime() - a) * 1000)
        }))
        t += 2.8
      }
    }
  }

  func step(now: Double, host: Host) {
    if t0 == nil { t0 = now }
    let t = now - t0!
    while let p = plan.first, t >= p.at {
      plan.removeFirst()
      flush()
      phase = p.act(host)
      Log.shared.add("bench", phase)
    }
    if plan.isEmpty && !phase.isEmpty { flush(); phase = ""; Log.shared.add("bench", "done") }
  }

  // кадр: draw — время рисования, gap — интервал от прошлого кадра
  func frame(draw: Double, gap: Double, host: Host) {
    guard !phase.isEmpty else { return }
    n += 1; sum += draw; mx = max(mx, draw)
    let late = gap > 1.5 / 60
    if late { miss += 1 }
    if draw > 0.008 || late {
      let nv = host.nav, k = nv.anim.map { String(format: "%@ k%.2f", $0.out ? "out" : "in", nv.k(CACurrentMediaTime())) } ?? (nv.view == .map ? "map" : "world")
      Log.shared.add("bench", String(format: "  slow %@ draw %.1f gap %.1f ms", k, draw * 1000, gap * 1000))
    }
  }

  private func flush() {
    guard n > 0 else { return }
    Log.shared.add("bench", String(format: "  sum %@: %d frames avg %.1f max %.1f ms miss %d", phase, n, sum / Double(n) * 1000, mx * 1000, miss))
    n = 0; sum = 0; mx = 0; miss = 0
  }
}
