import Foundation
import QuartzCore
import T2DCore

// замеры: строка раз в секунду (в лог и на панель). Кадр — время рисования и пропуски (интервал > 1.5 × 1/60), окно как у t2d_app_stats.
final class Meter {
  var visible = false
  private var lastStart: Double?
  private var n = 0, sum = 0.0, mx = 0.0, miss = 0

  func frame(start: CFTimeInterval, end: CFTimeInterval, missed: Int) {
    if let p = lastStart, start - p > 1.5 / 60 { miss += 1 }
    lastStart = start
    miss += missed
    let d = max(0, end - start)
    n += 1; sum += d; mx = max(mx, d)
  }

  // версия и хеш сборки для панели: хеш — ключ T2DBuildHash в Info.plist, если его кто-то положил (шага сборки для него нет)
  static func buildLabel(_ info: [String: Any]?) -> String {
    var s = "v" + ((info?["CFBundleShortVersionString"] as? String) ?? "?")
    if let h = info?["T2DBuildHash"] as? String, !h.isEmpty { s += " · " + h }
    return s
  }

  // снимает окно кадров; stats уже снято вызывающим (t2d_app_stats)
  func line(stats s: t2d_app_stats_t, outLat: Double, frames: Int, sr: Double, stars: Int) -> String {
    let lat = s.lat_n == 0 ? "–" : String(format: "%.1f/%.1f ms", (s.lat_avg + outLat) * 1000, (s.lat_max + outLat) * 1000)
    let fr = String(format: "%.1f/%.1f", n > 0 ? sum / Double(n) * 1000 : 0, mx * 1000)
    let snap = s.snap_n == 0 ? "–" : String(format: "%.2f/%.2f ms", s.snap_avg * 1000, s.snap_max * 1000)
    let out = String(format: "lat %@ · load %.0f/%.0f %% · snap %@, lost %u · frame %@ ms · miss %d · buf %d@%.0f · stars %d",
                     lat, s.load_avg * 100, s.load_max * 100, snap, s.snap_lost, fr, miss, frames, sr, stars)
    n = 0; sum = 0; mx = 0; miss = 0
    return out
  }
}
