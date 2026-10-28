import Foundation
import CoreGraphics

// громкость — как host/audio.js: позиция фейдера 0…1 → дБ → усиление; снизу off, выше нуля — до +6 дБ
enum Vol {
  static let travel: CGFloat = 220, lo = -48.0, hi = 6.0
  static let def = -lo / (hi - lo)
  static func db(_ t: Double) -> Double { lo + (hi - lo) * t }
  static func gain(_ t: Double) -> Double { t < 0.005 ? 0 : pow(10, db(t) / 20) }
  static func text(_ t: Double) -> String {
    if t < 0.005 { return "off" }
    let d = db(t)
    return "\(d > 0.5 ? "+" : "")\(Int(floor(d + 0.5))) dB"      // округление как Math.round в JS
  }
}

// лады — как host/scale.js: подписи ладов и нот (от A)
enum Scales {
  static let labels = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian"]
  static let notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
}
