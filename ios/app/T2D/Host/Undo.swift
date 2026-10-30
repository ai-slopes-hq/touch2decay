import Foundation

// шаг отмены: мир до жеста, лад до и после (лад откатывается, только если с тех пор его не трогали)
struct UndoStep { let w: String; let scl: Scl; let after: Scl }

// отмена поверх асинхронных снимков ядра — как host/undo.js, но снимок приходит через кольцо
final class Undo {
  static let max = 10

  private struct Base { var w: String; var scl: Scl }
  private struct Slot {
    var base: Base?                       // nil — база ещё не известна, её станет первый ответ
    var hist: [UndoStep] = []
    var lastId = 0                        // последний выданный id этого мира
    var floor = 0                         // ответы с id <= floor относятся к запросам до undo — отброшены
    var skipStep = false                  // после undo: ответ на следующий commit — база без шага
  }

  private let core: HostCore
  private var slots: [Int: Slot] = [:]
  private var pending: [Int: (slot: Int, scl: Scl)] = [:]   // выданные запросы без ответа
  private var nextId = 1

  init(core: HostCore) { self.core = core }

  // начало: w есть — база сразу; nil — следующий ответ снимка станет базой
  func base(slot: Int, w: String?, scl: Scl) {
    var s = slots[slot] ?? Slot()
    s.base = w.map { Base(w: $0, scl: scl) }
    s.skipStep = false
    s.floor = s.lastId                    // запросы до base устарели (повторная инициализация ядра)
    slots[slot] = s
  }

  // конец жеста: запрос снимка с новым id, лад — на момент запроса
  func commit(slot: Int, scl: Scl) {
    let id = nextId
    guard core.snap(slot: slot, id: id) else { return }   // кольцо полно — запроса нет
    nextId += 1
    var s = slots[slot] ?? Slot()
    s.lastId = id
    slots[slot] = s
    pending[id] = (slot, scl)
  }

  // из кадра: разобрать все ответы; вернуть последнюю новую базу, если она сменилась (для автосохранения)
  func poll() -> (slot: Int, w: String, scl: Scl)? { pollAll().last }

  // то же, но по новой базе на каждый слот — ответы нескольких миров в одном кадре (reapply) не теряются
  func pollAll() -> [(slot: Int, w: String, scl: Scl)] {
    var out: [Int: (slot: Int, w: String, scl: Scl)] = [:]
    while let r = core.takeSnap() {
      guard let req = pending.removeValue(forKey: r.id), req.slot == r.slot,
            var s = slots[r.slot], r.id == s.lastId, r.id > s.floor else { continue }
      let new = Base(w: r.w, scl: req.scl)
      if let old = s.base, !s.skipStep {
        if old.w != new.w || old.scl != new.scl {
          s.hist.append(UndoStep(w: old.w, scl: old.scl, after: req.scl))
          if s.hist.count > Undo.max { s.hist.removeFirst() }
          s.base = new
          out[r.slot] = (r.slot, new.w, new.scl)
        }
      } else {
        let changed = s.base.map { $0.w != new.w || $0.scl != new.scl } ?? true
        s.base = new
        s.skipStep = false
        if changed { out[r.slot] = (r.slot, new.w, new.scl) }
      }
      slots[r.slot] = s
    }
    return out.values.sorted { $0.slot < $1.slot }
  }

  // scl — лад, который надо вернуть (менялся в шаге и с тех пор не трогали); done false — шагов нет или кольцо полно
  func undo(slot: Int, cur: Scl) -> (done: Bool, scl: Scl?) {
    guard var s = slots[slot], let st = s.hist.last else { return (false, nil) }
    guard core.restore(slot: slot, st.w) else { return (false, nil) }
    s.hist.removeLast()
    let back = (st.scl != st.after && cur == st.after) ? st.scl : nil
    s.base = Base(w: st.w, scl: back ?? cur)
    s.floor = s.lastId                    // запросы до undo устарели
    s.skipStep = true                     // первый принятый ответ — база без шага
    // запрос «пересборки» сразу за restore: его ответ — мир после restore (как rebase в host/undo.js);
    // кольцо полно — первым принятым станет ответ на следующий commit
    let id = nextId
    if core.snap(slot: slot, id: id) {
      nextId += 1
      s.lastId = id
      pending[id] = (slot, back ?? cur)
    }
    slots[slot] = s
    return (true, back)
  }

  func depth(slot: Int) -> Int { slots[slot]?.hist.count ?? 0 }

  func last(slot: Int) -> (w: String, scl: Scl)? { slots[slot]?.base.map { ($0.w, $0.scl) } }
}
