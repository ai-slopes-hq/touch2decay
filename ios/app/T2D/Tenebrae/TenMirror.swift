import Foundation

// зеркало ядра Tenebrae (core/worlds/tenebrae/world.cpp:307-347): заголовок 15, голос 15 + 62·i, контуры с 387 по 129.
// Разбор терпит битое: короче 387 или [0] ≠ 6 — отказ, прежнее цело; не конечное поле — поле прежнее

struct TenMod: Equatable { var src: Int; var type: Int; var depth: Double; var auto: Bool }
struct TenLfo: Equatable { var morph: Double, rate: Double, depth: Double }

struct TenVoiceM: Equatable {
  var active = false, live = false, pinned = false, held = false
  var x = 0.0, y = 0.0, beat = 0.0, wave = 0.0, fm = 0.0, cut = 0.0, res = 0.0, shift = 0.0, amp = 0.0
  var holeT = 0.0, sunT = 0.0, env = 0.0, envT = 0.0
  var mods: [TenMod] = []                              // до 5 связей: кто модулирует этот голос
  var lfo = [TenLfo?](repeating: nil, count: 8)        // по ключам LfoKey; nil — LFO нет
}

struct TenMirror: Equatable {
  var time = 0.0, strikes = 0
  var fx = [0.3, 3.5, 0.3, 0, 0.2]                     // rev, decay, dly, chaos, dirt
  var kept: [Int] = []                                 // индексы планет с открытой плашкой
  var v = [TenVoiceM](repeating: TenVoiceM(), count: Ten.voices)
  var scope: [[Float]]?                                // 6 × 128 точек контура; nil — зеркало без контуров (нет живых)
  var scopeLive = [Bool](repeating: false, count: Ten.voices)

  // n — длина записанного в b; b.count может быть больше (буфер 2048)
  mutating func load(_ b: [Double], n: Int) -> Bool {
    let n = min(n, b.count)
    guard n >= Ten.mirrorN, b[0] == Double(Ten.voices) else { return false }
    func num(_ x: Double, _ f: inout Double) { if x.isFinite { f = x } }
    func flag(_ x: Double, _ f: inout Bool) { if x.isFinite { f = x > 0.5 } }
    if b[1].isFinite { time = b[1] }
    if b[2].isFinite, abs(b[2]) < 1e9 { strikes = Int(Horo.jsRound(b[2])) }
    for k in 0..<5 { num(b[3 + k], &fx[k]) }
    if b[8].isFinite {
      kept.removeAll(keepingCapacity: true)
      for k in 0..<min(6, max(0, Int(Horo.jsRound(min(b[8], 6))))) {
        let e = b[9 + k]
        if e.isFinite, e >= 0, e < Double(Ten.voices) { kept.append(Int(Horo.jsRound(e))) }
      }
    }
    for i in 0..<Ten.voices {
      let o = Ten.head + Ten.voiceN * i
      flag(b[o], &v[i].active); flag(b[o + 1], &v[i].live); flag(b[o + 2], &v[i].pinned); flag(b[o + 3], &v[i].held)
      num(b[o + 4], &v[i].x); num(b[o + 5], &v[i].y); num(b[o + 6], &v[i].beat); num(b[o + 7], &v[i].wave); num(b[o + 8], &v[i].fm)
      num(b[o + 9], &v[i].cut); num(b[o + 10], &v[i].res); num(b[o + 11], &v[i].shift); num(b[o + 12], &v[i].amp)
      num(b[o + 13], &v[i].holeT); num(b[o + 14], &v[i].sunT); num(b[o + 15], &v[i].env); num(b[o + 16], &v[i].envT)
      if b[o + 17].isFinite {                          // число связей не конечное — связи прежние
        v[i].mods.removeAll(keepingCapacity: true)
        for k in 0..<min(5, max(0, Int(Horo.jsRound(min(b[o + 17], 5))))) {
          let q = o + 18 + 4 * k
          guard b[q].isFinite, b[q + 1].isFinite, b[q + 2].isFinite, b[q + 3].isFinite else { continue }
          let src = Int(Horo.jsRound(b[q])), type = Int(Horo.jsRound(b[q + 1]))
          guard (0..<Ten.voices).contains(src), (0..<Ten.linkTypes.count).contains(type) else { continue }
          v[i].mods.append(TenMod(src: src, type: type, depth: b[q + 2], auto: b[q + 3] > 0.5))
        }
      }
      for k in 0..<8 {
        let q = o + 38 + 3 * k
        guard b[q].isFinite, b[q + 1].isFinite, b[q + 2].isFinite else { continue }
        v[i].lfo[k] = b[q + 2] < 0 ? nil : TenLfo(morph: b[q], rate: b[q + 1], depth: b[q + 2])
      }
    }
    if n >= Ten.mirrorFull {
      if scope == nil { scope = [[Float]](repeating: [Float](repeating: 0, count: Ten.scopePts), count: Ten.voices) }   // единственная аллокация
      for i in 0..<Ten.voices {
        let o = Ten.mirrorN + Ten.scopeN * i
        scopeLive[i] = b[o].isFinite && b[o] > 0.5
        for k in 0..<Ten.scopePts { let x = b[o + 1 + k]; scope![i][k] = x.isFinite ? Float(x) : 0 }
      }
    } else {
      scope = nil
      for i in 0..<Ten.voices { scopeLive[i] = false }
    }
    return true
  }
}

// «услышанное» ядром (heard): [1, i] — вспышка планеты i, [2, i, p] — удар по солнцу планетой i силой p
enum TenHeard: Equatable { case flash(Int), strike(Int, Double) }

func tenHeard(_ b: [Double], n: Int, into out: inout [TenHeard]) {
  out.removeAll(keepingCapacity: true)
  let n = min(n, b.count)
  func idx(_ x: Double) -> Int? { x.isFinite && x >= 0 && x < Double(Ten.voices) ? Int(Horo.jsRound(x)) : nil }
  var k = 0
  while k < n {
    guard b[k].isFinite else { return }
    switch Int(Horo.jsRound(max(-1, min(9, b[k])))) {
    case 1:
      guard k + 1 < n else { return }
      if let i = idx(b[k + 1]) { out.append(.flash(i)) }
      k += 2
    case 2:
      guard k + 2 < n else { return }
      if let i = idx(b[k + 1]), b[k + 2].isFinite { out.append(.strike(i, b[k + 2])) }
      k += 3
    default: return                                    // неизвестный вид — дальше длину записи не знаем
    }
  }
}
