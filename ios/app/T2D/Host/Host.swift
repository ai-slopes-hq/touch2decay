import UIKit

// хост: слой между Stage и миром — роутер касаний, отмена, автосохранение, порядок рисования.
// Время — только из tick(now:) и меток касаний (секунды); в мс переводится там, где TopBar.draw ждёт мс (как веб).
final class Host {
  let world: World
  private let core: HostCore, store: Store
  private let undo: Undo

  private(set) var vol: Double
  private(set) var scl = Scl.off
  private(set) var legendOpen = false, sclOpen = false

  private var bar = TopBar(W: 0, top: 0)
  private var W: CGFloat = 0, H: CGFloat = 0, top: CGFloat = 0, safeBot: CGFloat = 0
  private var titleW: CGFloat = 0                              // из последнего draw: нужна попаданию по заголовку
  private var now = 0.0
  private var diceAt = -1e9                                    // мс: кость крутится 400 мс после броска

  // у пальца, начатого на хосте, своя цель до подъёма — миру он не уходит
  private enum Route { case world, btn(Btn), title, list, eat }
  private var routes: [ObjectIdentifier: Route] = [:]
  private var volF: (id: ObjectIdentifier, v0: Double, y0: CGFloat)?

  private var scene: (w: String, scl: Scl)?                    // последний известный снимок: из него автосохранение и reinit
  private var dirtyAt: Double?                                 // когда сцена изменилась; запись — через autosave секунд
  private var loaded = false                                   // файл сцены читаем один раз — дальше сцена в памяти
  private static let autosave = 3.0

  init(world: World, core: HostCore, store: Store) {
    self.world = world; self.core = core; self.store = store
    undo = Undo(core: core)
    // prefs: нечисло и выход за 0…1 — не доверяем
    let v = store.loadPrefs()?.vol ?? Vol.def
    vol = v.isFinite ? min(max(v, 0), 1) : Vol.def
  }

  // top — верхний inset (safe area); строка кнопок и мир считают от него
  func layout(W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H; self.top = top; self.safeBot = safeBot
    bar = TopBar(W: W, top: top)
    world.layout(W: W, H: H, topY: top + 44, safeBot: safeBot)
  }

  // ---------- касания ----------
  func down(_ f: Finger) {
    let r = route(f)
    routes[f.id] = r
    switch r {
    case .btn(.vol): volF = (f.id, vol, f.y)
    case .world: world.down(f)
    default: break
    }
  }

  // легенда → список ладов → верхняя строка / предмет-угол → мир
  private func route(_ f: Finger) -> Route {
    if legendOpen { return .title }
    if sclOpen { return .list }
    switch bar.hit(f.x, f.y, titleW: titleW) {
    case .title: return .title
    case .btn(let b): return .btn(b)
    case nil: break
    }
    return world.cornerHit(f.x, f.y) ? .eat : .world        // карты в 2b-1 нет: предмет в углу приглушён и съедает касание
  }

  func move(_ f: Finger) {
    guard let r = routes[f.id] else { return }
    switch r {
    case .world: world.move(f)
    case .btn(.vol):
      guard let d = volF, d.id == f.id else { return }
      vol = min(max(d.v0 - Double((f.y - d.y0) / Vol.travel), 0), 1)
      core.vol(Vol.gain(vol))
    default: break
    }
  }

  func up(_ f: Finger) {
    guard let r = routes.removeValue(forKey: f.id) else { return }
    switch r {
    case .world: world.up(f)
    case .title:
      if legendOpen { legendOpen = false }
      else if bar.hit(f.x, f.y, titleW: titleW) == .title { legendOpen = true }
    case .list: pick(bar.sclPick(f.x, f.y))
    case .btn(let b):
      if b == .vol { volF = nil; store.savePrefs(PrefsFile(vol: vol)) }
      else if bar.hit(f.x, f.y, titleW: titleW) == .btn(b) { press(b) }
    case .eat: break
    }
    endGesture()
  }

  // система отняла касание: действий нет, но жест кончился
  func cancel(_ f: Finger) {
    guard let r = routes.removeValue(forKey: f.id) else { return }
    if case .world = r { world.cancel(f) }
    if case .btn(.vol) = r { volF = nil; store.savePrefs(PrefsFile(vol: vol)) }
    endGesture()
  }

  private func endGesture() { if routes.isEmpty { undo.commit(slot: world.slot, scl: scl) } }

  private func press(_ b: Btn) {
    switch b {
    case .scl: sclOpen = true
    case .dice: world.dice(); diceAt = now * 1000
    case .clr: world.clear()
    case .undo: undoStep()
    case .back, .rev, .vol: break                           // приглушены в 2b-1: тап съеден
    }
  }

  // выбор в списке — по подъёму (задержку веба на смену строки не переносим); список остаётся — можно выбрать и тонику
  private func pick(_ p: SclPick) {
    var s = scl
    switch p {
    case .outside: sclOpen = false; return
    case .off: s.on = false
    case .scale(let i): s.on = true; s.idx = i
    case .root(let r): s.on = true; s.root = r
    }
    if s != scl { scl = s; core.scale(s) }
  }

  private func undoStep() {
    let r = undo.undo(slot: world.slot, cur: scl)
    guard r.done else { return }
    world.restored()
    if let s = r.scl { scl = s; core.scale(s) }
    if let b = undo.last(slot: world.slot) { setScene(b.w, b.scl) }   // undo.poll базу после undo не отдаёт
  }

  private func setScene(_ w: String, _ s: Scl) { scene = (w, s); dirtyAt = now }

  // ---------- кадр и сохранение ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    world.tick(now: now, dt: dt)
    if let b = undo.poll() { setScene(b.w, b.scl) }
    if let t = dirtyAt, now - t >= Host.autosave { saveScene() }
  }

  private func saveScene() {
    dirtyAt = nil
    if let s = scene { store.saveScene(slot: world.slot, SceneFile(w: s.w, scl: s.scl)) }
  }

  // в фон: сразу сцена и prefs, таймер снят
  func background() {
    saveScene()
    store.savePrefs(PrefsFile(vol: vol))
  }

  // из Audio.onInit — после t2d_app_init (запуск и смена частоты): init стёр миры и сбросил громкость, лад остался.
  // Порядок: restore сцены, лад, громкость. Можно звать повторно.
  func reapply() {
    if scene == nil && !loaded, let f = store.loadScene(slot: world.slot) { scene = (f.w, f.scl) }
    loaded = true
    if let s = scene {
      core.restore(slot: world.slot, s.w)
      scl = s.scl
      world.restored()
    }
    core.scale(scl)
    core.vol(Vol.gain(vol))
    // первый снимок после восстановления — база отмены (текст после restore может отличаться от сохранённого)
    undo.base(slot: world.slot, w: nil, scl: scl)
    undo.commit(slot: world.slot, scl: scl)
  }

  // ---------- рисование ----------
  func draw(_ d: Draw, now: Double) {
    world.draw(d, now: now)
    let st = TopBar.State(title: world.title, vol: vol, volHeld: volF != nil, scl: scl, sclOpen: sclOpen,
                          canUndo: undo.depth(slot: world.slot) > 0, hasFx: world.hasFx, diceAt: diceAt)
    titleW = bar.draw(d, st, now: now * 1000)
    if legendOpen { Legend.draw(d, title: "L E G E N D A", rows: world.legend, W: W, H: H, top: top, safeBot: safeBot) }
  }
}
