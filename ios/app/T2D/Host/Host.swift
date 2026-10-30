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
  private(set) var sheet: Sheet? {                         // открытая плашка: забирает касания целиком
    didSet { lfos = sheet == nil ? [] : core.lfoSnap(); pending.removeAll() }   // снимок свежий с открытия
  }
  private(set) var lfos: [LfoSnap] = []                        // снимок LFO ядра: только пока открыта плашка (раз в кадр)
  private struct LfoKey: Hashable { var slot, obj, key: Int }
  private var pending: [LfoKey: Double] = [:]                  // lfoAdd послан, снимок ещё без него: когда послан (с) — не слать снова
  private static let pendingTTL = 0.25                         // дольше — считаем, что кольцо отбросило

  private var bar = TopBar(W: 0, top: 0)
  private var W: CGFloat = 0, H: CGFloat = 0, top: CGFloat = 0, safeBot: CGFloat = 0
  private var titleW: CGFloat = 0                              // из последнего draw: нужна попаданию по заголовку
  private var now = 0.0
  private var diceAt = -1e9                                    // мс: кость крутится 400 мс после броска

  // у пальца, начатого на хосте, своя цель до подъёма — миру он не уходит
  private enum Route { case world, btn(Btn), title, list, sheet(SheetHit), eat }
  private var routes: [ObjectIdentifier: Route] = [:]
  private var volF: (id: ObjectIdentifier, v0: Double, y0: CGFloat)?
  private var rowF: (id: ObjectIdentifier, key: String, v0: Double)?    // строка плашки в руках: база на момент касания
  private var padDepth: (id: ObjectIdentifier, d: Double)?                                        // последняя посланная глубина пада — для снятия на подъёме
  var fxHeld: Bool { routes.values.contains { if case .btn(.rev) = $0 { return true } else { return false } } }

  private var scene: (w: String, scl: Scl)?                    // последний известный снимок: из него автосохранение и reinit
  private var dirtyAt: Double?                                 // когда сцена изменилась; запись — через autosave секунд
  static let edgeW: CGFloat = 14                               // ui-top.js EDGE_W
  private var loaded = false                                   // файл сцены читаем один раз — дальше сцена в памяти
  private static let autosave = 3.0

  init(world: World, core: HostCore, store: Store) {
    self.world = world; self.core = core; self.store = store
    undo = Undo(core: core)
    // prefs: нечисло и выход за 0…1 — не доверяем
    let v = store.loadPrefs()?.vol ?? Vol.def
    vol = v.isFinite ? min(max(v, 0), 1) : Vol.def
    world.openSheet = { [weak self] spec in
      guard let self else { return }
      self.sheet = Sheet(spec: spec, slot: self.world.slot)
    }
    world.objGone = { [weak self] id in
      guard let self else { return }
      self.core.lfoDrop(slot: self.world.slot, obj: id)
      if self.sheet?.spec.lfo?.obj == id { self.sheet = nil }
    }
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
    case .sheet(let h): sheetDown(h, f)
    default: break
    }
  }

  // легенда → плашка → список ладов → верхняя строка / предмет-угол → мир
  private func route(_ f: Finger) -> Route {
    if legendOpen { return .title }
    if let s = sheet { return .sheet(sheetHit(s, geo(s), x: f.x, y: f.y, fxBtn: bar.pos(.rev))) }
    if sclOpen { return .list }
    switch bar.hit(f.x, f.y, titleW: titleW) {
    case .title: return .title
    case .btn(let b): return .btn(b)
    case nil: break
    }
    if f.x < Host.edgeW && f.y > top + 44 { return .eat }   // левая полоса под строкой — как headHit в вебе (EDGE_W = 14)
    return world.cornerHit(f.x, f.y) ? .eat : .world        // карты в 2b-1 нет: предмет в углу приглушён и съедает касание
  }

  func move(_ f: Finger) {
    guard let r = routes[f.id] else { return }
    switch r {
    case .world: world.move(f)
    case .sheet(let h): sheetMove(h, f)
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
    case .sheet(let h): sheetUp(h, f)
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
    if case .sheet = r { releaseSheet(f) }
    endGesture()
  }

  private func endGesture() { if routes.isEmpty { undo.commit(slot: world.slot, scl: scl) } }

  private func press(_ b: Btn) {
    switch b {
    case .scl: sclOpen = true
    case .dice: world.dice(); diceAt = now * 1000
    case .clr: world.clear()
    case .undo: undoStep()
    case .rev: if let fx = world.fx { sheet = Sheet(spec: fx, slot: world.slot) }
    case .back, .vol: break                                 // приглушены: тап съеден
    }
  }

  // ---------- плашка и LFO строк (host/sheet.js) ----------
  private func geo(_ s: Sheet) -> SheetGeo { SheetGeo.make(s, W: W, H: H, safeBot: safeBot) }
  private func code(_ s: Sheet, _ k: String) -> Int? { s.spec.rows.first { $0.key == k }?.code }
  // LFO строки в снимке ядра (nil — нет: не поставлен, отброшен или ядро переинициализировано)
  private func lfo(_ s: Sheet, _ k: String) -> LfoSnap? {
    guard let l = s.spec.lfo, let c = code(s, k) else { return nil }
    return lfos.first { $0.slot == s.slot && $0.obj == l.obj && $0.key == c }
  }
  // LFO есть в снимке или его lfoAdd ещё в пути (снимок отстаёт ≥ кадра)
  private func hasLfo(_ s: Sheet, _ k: String) -> Bool {
    if lfo(s, k) != nil { return true }
    guard let l = s.spec.lfo, let c = code(s, k) else { return false }
    let key = LfoKey(slot: s.slot, obj: l.obj, key: c)
    guard let t = pending[key] else { return false }
    if now - t > Host.pendingTTL { pending[key] = nil; return false }
    return true
  }
  // поставить LFO строки, если его нет (как slAdd); панель открывается и когда кольцо отбросило lfoAdd — пад поставит заново
  private func ensureLfo(_ s: Sheet, _ k: String) {
    guard let l = s.spec.lfo, let c = code(s, k), !hasLfo(s, k) else { return }
    core.lfoAdd(slot: s.slot, obj: l.obj, key: c, base: s.spec.get(k), shape: l.shape)
    pending[LfoKey(slot: s.slot, obj: l.obj, key: c)] = now
  }

  private func sheetDown(_ h: SheetHit, _ f: Finger) {
    guard let s = sheet else { return }
    switch h {
    case .close: sheet = nil
    case .off:
      if let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) {
        core.lfoOff(slot: s.slot, obj: l.obj, key: c); pending[LfoKey(slot: s.slot, obj: l.obj, key: c)] = nil
      }
    case .lfo(let k):
      if s.lfoKey == k { s.lfoKey = nil } else { ensureLfo(s, k); s.lfoKey = k }
    case .strip, .pad: padApply(h, f)
    case .row(let k): rowF = (f.id, k, lfo(s, k)?.base ?? s.spec.get(k))   // pending: снимка нет — база от get (LFO ещё не сдвинул)
    case .none: break
    }
  }

  private func padApply(_ h: SheetHit, _ f: Finger) {
    guard let s = sheet, let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) else { return }
    let p = geo(s).panel
    ensureLfo(s, k)
    if h == .strip { core.lfoSpec(slot: s.slot, obj: l.obj, key: c, morph: Pad.shapeT(p, f.x), rate: .nan, depth: .nan) }
    else {
      let d = Pad.depth(p, f.y)
      padDepth = (f.id, d)
      core.lfoSpec(slot: s.slot, obj: l.obj, key: c, morph: .nan, rate: Pad.rate(p, f.x), depth: d)
    }
  }

  private func sheetMove(_ h: SheetHit, _ f: Finger) {
    guard let s = sheet else { return }
    switch h {
    case .strip, .pad: padApply(h, f)
    case .row:
      guard let r = rowF, r.id == f.id else { return }
      let g = geo(s), v = min(1, max(0, r.v0 + Double((f.x - f.x0) / (g.tx1 - g.tx0))))
      if let l = s.spec.lfo, hasLfo(s, r.key), let c = code(s, r.key) { core.lfoBase(slot: s.slot, obj: l.obj, key: c, base: v) }
      else { s.spec.set(r.key, v) }
    default: break
    }
  }

  // палец ушёл: гасим только то, что держал он сам
  private func releaseSheet(_ f: Finger) {
    if rowF?.id == f.id { rowF = nil }
    if padDepth?.id == f.id { padDepth = nil }
  }

  private func sheetUp(_ h: SheetHit, _ f: Finger) {
    let pd = padDepth?.id == f.id ? padDepth?.d : nil
    releaseSheet(f)
    guard let s = sheet, h == .pad, let d = pd, d < 0.03, let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) else { return }
    core.lfoOff(slot: s.slot, obj: l.obj, key: c); pending[LfoKey(slot: s.slot, obj: l.obj, key: c)] = nil     // глубина в ноль — LFO снимается (sheet.js:81)
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
    world.restored(); pending.removeAll()
    if let s = r.scl { scl = s; core.scale(s) }
    if let b = undo.last(slot: world.slot) { setScene(b.w, b.scl) }   // undo.poll базу после undo не отдаёт
  }

  private func setScene(_ w: String, _ s: Scl) { scene = (w, s); dirtyAt = now }

  // только -shot: состояние сцены без касаний (список ладов и легенда открываются жестом, снимку нужен готовый кадр)
  func shotState(scl s: Scl, sclOpen: Bool = false, legendOpen: Bool = false) {
    scl = s; core.scale(s)
    self.sclOpen = sclOpen; self.legendOpen = legendOpen
  }

  // только -shot: плашка открыта без касаний (FX мира или звезда id), при lfoKey — с панелью LFO этой строки
  func shotSheet(_ spec: SheetSpec, lfoKey: String? = nil) {
    let s = Sheet(spec: spec, slot: world.slot)
    if let k = lfoKey { ensureLfo(s, k); s.lfoKey = k }
    sheet = s
  }
  // только -shot: LFO строки 1 Гц, глубина 0.5 (как пад в веб-сценарии firmsheet); nil — строки нет
  func shotLfo(rate: Double, depth: Double) {
    guard let s = sheet, let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) else { return }
    core.lfoSpec(slot: s.slot, obj: l.obj, key: c, morph: .nan, rate: rate, depth: depth)
  }

  // ---------- кадр и сохранение ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    world.tick(now: now, dt: dt)
    if sheet != nil { lfos = core.lfoSnap() }
    if let b = undo.poll() { setScene(b.w, b.scl) }
    if let t = dirtyAt, now - t >= Host.autosave { saveScene() }
  }

  private func saveScene() {
    dirtyAt = nil
    if let s = scene { store.saveScene(slot: world.slot, SceneFile(w: s.w, scl: s.scl)) }
  }

  // в фон: сразу сцена и prefs, таймер снят
  func background() {
    if let b = undo.poll() { setScene(b.w, b.scl) }          // ответ, пришедший без тика, иначе потеряется
    saveScene()
    store.savePrefs(PrefsFile(vol: vol))
  }

  // из Audio.onInit — после t2d_app_init (запуск и смена частоты): init стёр миры и сбросил громкость, лад остался.
  // Порядок: restore сцены, лад, громкость. Можно звать повторно.
  func reapply() {
    if scene == nil && !loaded, let f = store.loadScene(slot: world.slot) { scene = (f.w, f.scl) }
    let first = !loaded
    loaded = true
    if let s = scene {
      core.restore(slot: world.slot, s.w)
      if first { scl = s.scl }                               // лад из файла — только при запуске; при reinit живой новее снимка
      world.restored(); pending.removeAll()
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
                          canUndo: undo.depth(slot: world.slot) > 0, fxArc: world.fx?.arc?(), fxHeld: fxHeld, diceAt: diceAt)
    titleW = bar.draw(d, st, now: now * 1000)
    if let s = sheet {
      var held: SheetHit?
      for r in routes.values { if case .sheet(let h) = r { held = h } }
      SheetDraw.draw(d, s, geo(s), lfos: lfos, held: held, sample: core.lfoSample)
    }
    if legendOpen { Legend.draw(d, title: "L E G E N D A", rows: world.legend, W: W, H: H, top: top, safeBot: safeBot) }
  }
}
