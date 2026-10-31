import Foundation

// зеркало ядра (47 чисел): fx 0…5, still 6, lux 7, cadit 8, strikes 9, encounters 10, тело i с 11 + 12·i — core/worlds/tria/world.hpp
struct TriaBody {
  var x = 0.0, y = 0.0, vx = 0.0, vy = 0.0, m = 1.0
  var fixed = false
  var semi = 0.0, level = 0.8, amp = 0.0, hz = 110.0, pairK = 0.0, trem = 0.0
}

struct TriaMirror {
  var fx = [Double](repeating: 0, count: 6)
  var still = false, lux = false, cadit = false
  var strikes = 0.0, encounters = 0.0
  var bodies: [TriaBody] = (0..<Tria.nb).map { i in
    let p = Tria.rest(i)
    return TriaBody(x: p.x, y: p.y)
  }

  // n < 47 — зеркало ещё не готово: прежнее остаётся
  mutating func load(_ b: [Double], n: Int) -> Bool {
    guard n >= Tria.mirrorN, b.count >= n else { return false }
    for k in 0..<6 { fx[k] = b[k] }
    still = b[6] == 1; lux = b[7] == 1; cadit = b[8] == 1
    strikes = b[9]; encounters = b[10]
    for i in 0..<Tria.nb {
      let o = Tria.head + i * Tria.bodyM
      bodies[i] = TriaBody(x: b[o], y: b[o + 1], vx: b[o + 2], vy: b[o + 3], m: b[o + 4], fixed: b[o + 5] == 1,
                           semi: b[o + 6], level: b[o + 7], amp: b[o + 8], hz: b[o + 9], pairK: b[o + 10], trem: b[o + 11])
    }
    return true
  }
}

// вспышка из heard: kind 0 ring, 1 ray, 2 rim, 3 conj
struct TriaFlashRec { var i = 0, kind = 0; var x = 0.0, y = 0.0, q = 0.0 }

// heard — записи [c, (i, kind, x, y, q) × c] подряд; c ≤ 0 или выход за n — стоп, плохая вспышка — пропуск
func triaHeard(_ b: [Double], n: Int, into out: inout [TriaFlashRec]) -> Int {
  let n = min(n, b.count)
  var o = 0, added = 0
  while o < n {
    let c = Int(b[o])
    if c <= 0 || o + 1 + c * 5 > n { break }
    for k in 0..<c {
      let p = o + 1 + k * 5
      let i = Int(b[p]), kind = Int(b[p + 1])
      if i < 0 || i >= Tria.nb || kind < 0 || kind > 3 { continue }
      out.append(TriaFlashRec(i: i, kind: kind, x: b[p + 2], y: b[p + 3], q: b[p + 4])); added += 1
    }
    o += 1 + c * 5
  }
  return added
}
