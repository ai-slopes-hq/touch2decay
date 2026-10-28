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
}

// живое ядро: t2d_app_action(T2D_HOST, …), t2d_app_restore, t2d_app_snap_take (см. core/app/t2d_app.h)
final class AppHostCore: HostCore {
  private static let cap = 65536                                      // строка мира — до 64 КБ
  private var buf = [CChar](repeating: 0, count: AppHostCore.cap)     // буфер takeSnap — выделен раз

  private func act(_ kind: Int32, _ i: Int, _ a: [Double]) -> Bool {
    var v = a
    return t2d_app_action(T2D_HOST, kind, Int32(i), &v, Int32(a.count), 0) != 0
  }

  func vol(_ gain: Double) -> Bool { act(Int32(T2D_H_VOL), 0, [gain]) }
  func scale(_ s: Scl) -> Bool { act(Int32(T2D_H_SCALE), 0, [s.on ? 1 : 0, Double(s.idx), Double(s.root)]) }
  func snap(slot: Int, id: Int) -> Bool { act(Int32(T2D_H_SNAP), slot, [Double(id)]) }

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
