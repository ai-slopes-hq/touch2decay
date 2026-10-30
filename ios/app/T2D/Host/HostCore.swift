import Foundation
import T2DCore

// лад: вкл/выкл, номер лада, тоника
struct Scl: Codable, Equatable {
  var on: Bool; var idx: Int; var root: Int
  static let off = Scl(on: false, idx: 0, root: 0)
}

// путь команд хоста в ядро: громкость, лад, снимки миров; живой — AppHostCore, тестовый — запись
protocol HostCore: AnyObject {
  @discardableResult func vol(_ gain: Double) -> Bool                 // false — действие отброшено (кольцо полно)
  @discardableResult func scale(_ s: Scl) -> Bool
  @discardableResult func snap(slot: Int, id: Int) -> Bool            // запросить снимок мира; готовый заберёт takeSnap
  @discardableResult func restore(slot: Int, _ w: String) -> Bool     // false — отброшено
  func takeSnap() -> (id: Int, slot: Int, w: String)?                 // по одному; nil — нет
  // LFO хоста (кольцом; false — отброшено). Double.nan в lfoSpec — не менять
  @discardableResult func lfoAdd(slot: Int, obj: Int, key: Int, base: Double, shape: Int) -> Bool
  @discardableResult func lfoSpec(slot: Int, obj: Int, key: Int, morph: Double, rate: Double, depth: Double) -> Bool
  @discardableResult func lfoBase(slot: Int, obj: Int, key: Int, base: Double) -> Bool
  @discardableResult func lfoOff(slot: Int, obj: Int, key: Int) -> Bool
  @discardableResult func lfoDrop(slot: Int, obj: Int) -> Bool        // obj −2 — все объекты слота (строки FX, obj −1, остаются)
  func lfoSnap() -> [LfoSnap]                                         // последний снимок ядра
  @discardableResult func levels(_ out: inout [Float]) -> Bool        // RMS слотов до фейдера (16); true — снимок новее прошлого чтения (иначе в out прошлый)
  func lfoSample(shape: Int, morph: Double, u: Double, seed: Int) -> Double
}

// строка снимка LFO ядра (по 10 чисел, см. t2d_app_lfo)
struct LfoSnap: Equatable {
  var slot, obj, key: Int
  var base, morph, rate, depth, u: Double
  var shape, seed: Int
}

// живое ядро: t2d_app_action(T2D_HOST, …), t2d_app_restore, t2d_app_snap_take (см. core/app/t2d_app.h)
final class AppHostCore: HostCore {
  private static let cap = 65536                                      // строка мира — до 64 КБ
  private var buf = [CChar](repeating: 0, count: AppHostCore.cap)     // буфер takeSnap — выделен раз
  private static let lfoRec = Int(T2D_APP_LFO_REC), lfoCap = Int(T2D_APP_LFO_MAX)   // записей в снимке LFO и чисел в записи (из ядра)
  private var lfoBuf = [Double](repeating: 0, count: AppHostCore.lfoCap * AppHostCore.lfoRec)   // буфер lfoSnap — выделен раз

  private func act(_ kind: Int32, _ i: Int, _ a: [Double]) -> Bool {
    var v = a
    return t2d_app_action(T2D_HOST, kind, Int32(i), &v, Int32(a.count), 0) != 0
  }

  func vol(_ gain: Double) -> Bool { act(Int32(T2D_H_VOL), 0, [gain]) }
  func scale(_ s: Scl) -> Bool { act(Int32(T2D_H_SCALE), 0, [s.on ? 1 : 0, Double(s.idx), Double(s.root)]) }
  func snap(slot: Int, id: Int) -> Bool { act(Int32(T2D_H_SNAP), slot, [Double(id)]) }

  func lfoAdd(slot: Int, obj: Int, key: Int, base: Double, shape: Int) -> Bool {
    act(Int32(T2D_H_LFO_ADD), slot, [Double(obj), Double(key), base, Double(shape)])
  }
  func lfoSpec(slot: Int, obj: Int, key: Int, morph: Double, rate: Double, depth: Double) -> Bool {
    act(Int32(T2D_H_LFO_SPEC), slot, [Double(obj), Double(key), morph, rate, depth])
  }
  func lfoBase(slot: Int, obj: Int, key: Int, base: Double) -> Bool {
    act(Int32(T2D_H_LFO_BASE), slot, [Double(obj), Double(key), base])
  }
  func levels(_ out: inout [Float]) -> Bool { t2d_app_levels(&out, Int32(out.count)) != 0 }
  func lfoOff(slot: Int, obj: Int, key: Int) -> Bool { act(Int32(T2D_H_LFO_OFF), slot, [Double(obj), Double(key)]) }
  func lfoDrop(slot: Int, obj: Int) -> Bool { act(Int32(T2D_H_LFO_DROP), slot, [Double(obj)]) }

  func lfoSnap() -> [LfoSnap] {
    let r = AppHostCore.lfoRec
    let n = Int(t2d_app_lfo(&lfoBuf, Int32(lfoBuf.count)))
    return lfoBuf.withUnsafeBufferPointer { b in   // без копии буфера
      stride(from: 0, to: n - n % r, by: r).map { i in
        LfoSnap(slot: Int(b[i]), obj: Int(b[i + 1]), key: Int(b[i + 2]), base: b[i + 3], morph: b[i + 4], rate: b[i + 5],
                depth: b[i + 6], u: b[i + 7], shape: Int(b[i + 8]), seed: Int(b[i + 9]))
      }
    }
  }

  func lfoSample(shape: Int, morph: Double, u: Double, seed: Int) -> Double {
    t2d_app_lfo_sample(Int32(shape), morph, u, Int32(seed))
  }

  func restore(slot: Int, _ w: String) -> Bool {
    let n = w.utf8.count
    return w.withCString { t2d_app_restore(Int32(slot), $0, Int32(n), 0) != 0 }
  }

  func takeSnap() -> (id: Int, slot: Int, w: String)? {
    var id: Int32 = 0, slot: Int32 = 0
    let n = Int(t2d_app_snap_take(&id, &slot, &buf, Int32(buf.count)))
    if n <= 0 { return nil }
    let w = buf.withUnsafeBufferPointer { String(decoding: UnsafeRawBufferPointer(start: $0.baseAddress, count: n), as: UTF8.self) }
    return (Int(id), Int(slot), w)
  }
}
