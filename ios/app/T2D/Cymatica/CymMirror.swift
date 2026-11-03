import Foundation

// зеркало ядра (175 чисел): 0…23 энергии мод, 24…31 голоса (hz, level) × 4, 32 f0, 33…39 fx, 40…44 bpm, playing, rec, rlen, mlen,
// 45… ритм 16 × (on, vel, chance, has), 109… мелодия 16 × (on, x, y), 157…161 луна (on, depth, rate, shape, k),
// 162…168 grid, lastHit x, y, cursor, stepRec on, r, m; дальше эхо (читает отдельный разбор) — core/worlds/cymatica/world.hpp
struct CymMirror {
  var energy = [Double](repeating: 0, count: 24)
  var voices = [(hz: Double, level: Double)](repeating: (0, 0), count: 4)
  var f0 = 110.0
  var fx = [2.0 / 7, 0.5, 0.5, 0.25, 0.15, 6.0 / 8, 1]
  var bpm = 96.0
  var playing = false, rec = false
  var rlen = 16, mlen = 7
  var rhythm = [CymStep](repeating: CymStep(), count: Cym.slots)
  var melody = [CymMark](repeating: CymMark(), count: Cym.slots)
  var drift = (on: false, depth: 0.3, rate: 0.5, shape: 0.0, k: 0)
  var grid = 1
  var lastHit = (x: 0.3, y: 0.0)
  var cursor = -1
  var stepRec = (on: false, r: 0, m: 0)

  // n < 175 — зеркало ещё не готово: прежнее остаётся; не конечное число — поле не меняется; флаг — «> 0.5»; целые — как Math.round
  mutating func load(_ b: [Double], n: Int) -> Bool {
    guard n >= Cym.mirrorN, b.count >= Cym.mirrorN else { return false }
    func num(_ v: Double, _ f: inout Double) { if v.isFinite { f = v } }
    func int(_ v: Double, _ f: inout Int) { if v.isFinite, abs(v) < 1e6 { f = Int(Horo.jsRound(v)) } }
    func flag(_ v: Double, _ f: inout Bool) { if v.isFinite { f = v > 0.5 } }
    for k in 0..<24 { num(b[k], &energy[k]) }
    for v in 0..<4 { num(b[24 + 2 * v], &voices[v].hz); num(b[25 + 2 * v], &voices[v].level) }
    num(b[32], &f0)
    for k in 0..<fx.count { num(b[33 + k], &fx[k]) }
    num(b[40], &bpm); flag(b[41], &playing); flag(b[42], &rec); int(b[43], &rlen); int(b[44], &mlen)
    for i in 0..<Cym.slots {
      let r = 45 + i * 4, m = 109 + i * 3
      flag(b[r], &rhythm[i].on); num(b[r + 1], &rhythm[i].vel); num(b[r + 2], &rhythm[i].chance); flag(b[r + 3], &rhythm[i].has)
      flag(b[m], &melody[i].on); num(b[m + 1], &melody[i].x); num(b[m + 2], &melody[i].y)
    }
    flag(b[157], &drift.on); num(b[158], &drift.depth); num(b[159], &drift.rate); num(b[160], &drift.shape); int(b[161], &drift.k)
    int(b[162], &grid); num(b[163], &lastHit.x); num(b[164], &lastHit.y); int(b[165], &cursor)
    flag(b[166], &stepRec.on); int(b[167], &stepRec.r); int(b[168], &stepRec.m)
    return true
  }
}

enum CymHeard: Equatable {
  case step(r: Int, m: Int, hit: Bool)
  case answer(semi: Int)
}

// heard — записи по 5: [1, r, m, time, hit] — сыгранный шаг, [2, нота, 0, 0, 0] — резонатор отзывается; плохая запись пропущена, хвост короче 5 отброшен
func cymHeard(_ b: [Double], n: Int, into out: inout [CymHeard]) {
  let n = min(n, b.count)
  var o = 0
  while o + 5 <= n {
    defer { o += 5 }
    let k = b[o]
    if k == 1 {
      let r = b[o + 1], m = b[o + 2]
      guard r.isFinite, m.isFinite else { continue }
      let ri = Int(Horo.jsRound(r)), mi = Int(Horo.jsRound(m))
      guard (0..<Cym.slots).contains(ri), (0..<Cym.slots).contains(mi) else { continue }
      out.append(.step(r: ri, m: mi, hit: b[o + 4].isFinite && b[o + 4] != 0))
    } else if k == 2, b[o + 1].isFinite, abs(b[o + 1]) < 1e6 {
      out.append(.answer(semi: Int(Horo.jsRound(b[o + 1]))))
    }
  }
}
