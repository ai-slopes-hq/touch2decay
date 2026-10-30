import UIKit

// хост: слой между Stage и мирами — режим карта / мир, роутер касаний, отмена, автосохранение, порядок рисования.
// Время — только из tick(now:) и меток касаний (секунды); в мс переводится там, где TopBar.draw ждёт мс (как веб).
final class Host {
  private let views: [Int: World]                          // миры с нативным видом, по слоту
  private let slots: [Int]                                 // они же по возрастанию слота — порядок обхода
  private let core: HostCore, store: Store
  private let undo: Undo

  private(set) var nav = Nav()                             // режим (карта / мир), переход, peek
  var world: World? { if case .world(let s) = nav.view { return views[s] } else { return nil } }   // мир режима .world; на карте и во входе — nil
  var theme: Theme { world?.theme ?? .base }
  private(set) var snaps: [Int: CGImage] = [:]             // снимок мира при уходе на карту, по слоту
  private var levels = Levels()
  private var field = MapGeo.field(W: 0, H: 0, top: 0, safeBot: 0)

  private(set) var vol: Double
  private(set) var settings = Settings.off                 // открытые общие настройки на карте (concordia / микшер)
  private(set) var mix = Mix()                             // микшер: фейдеры миров, mute, мастер
  private var mixGeo = Mixer.geo(W: 0, H: 0, top: 0, safeBot: 0)   // раз на layout
  private var mixTap: (key: Mixer.Key, t: Double)?             // последний тап по строке: двойной — значение по умолчанию
  private(set) var link = Link()                           // общие темп и лад миров
  private(set) var audioPref = AudioPref()
  private(set) var restartAt = -Double.infinity            // когда последний раз перезапускали звук (с): вспышка «audio restarted» 0.9 с
  var onRestart: (() -> Void)?                             // ставит App: Audio.restart
  var onStable: ((Bool) -> Void)?                          // ставит App: Audio.stable
  private var perScl: [Int: Scl] = [:]                     // свой лад у каждого мира, когда лад не общий (в памяти, как perScl веба)
  private var lastSlot: Int?                               // мир, в котором были последним
  private var prefsDirtyAt: Double?                        // настройки изменились; запись — через autosave секунд
  private(set) var audioPanel = false                        // панель audio под кнопкой громкости (только в мире)
  private var apGeo = AudioPanel.geo(bar: TopBar(W: 0, top: 0), W: 0)   // раз на layout
  private var cBox = Concordia.box(W: 0, H: 0, safeBot: 0, sunY: 0)   // коробка настроек: раз на layout, не на кадр
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
  private enum Route { case world(Int), btn(Btn), title, list, sheet(SheetHit), edge, corner, eat, mix(Mixer.Key, Double), panel(AudioPanel.Key) }   // panel: строка панели audio; // mix: строка и её база на касании
  private var routes: [ObjectIdentifier: Route] = [:]
  private var volF: (id: ObjectIdentifier, v0: Double, y0: CGFloat)?
  private var rowF: (id: ObjectIdentifier, key: String, v0: Double)?    // строка плашки в руках: база на момент касания
  private var padDepth: (id: ObjectIdentifier, d: Double)?                                        // последняя посланная глубина пада — для снятия на подъёме
  private func held(_ b: Btn) -> Bool { routes.values.contains { if case .btn(b) = $0 { return true } else { return false } } }
  var fxHeld: Bool { held(.rev) }
  private var touched: Set<Int> = []                       // слоты миров, которых коснулся текущий жест: undo.commit — по каждому

  private var scenes: [Int: (w: String, scl: Scl)] = [:]      // последний известный снимок мира по слоту: из него автосохранение и reinit
  private var dirtyAt: [Int: Double] = [:]                     // когда сцена слота изменилась; запись — через autosave секунд
  static let edgeW: CGFloat = 14                               // ui-top.js EDGE_W
  private static let edgeDx: CGFloat = 64, edgeSlope: CGFloat = 0.7   // свайп от края: app.js:883
  private var loaded: Set<Int> = []                            // файл сцены читаем один раз — дальше сцена в памяти
  private var started = false                                  // лад из файла берём только при запуске
  private static let autosave = 3.0

  init(views: [World], core: HostCore, store: Store) {
    self.views = Dictionary(uniqueKeysWithValues: views.map { ($0.slot, $0) })
    slots = views.map(\.slot).sorted()
    self.core = core; self.store = store
    undo = Undo(core: core)
    // prefs: нечисло и выход за 0…1 — не доверяем
    let v = store.loadPrefs()?.vol ?? Vol.def
    vol = v.isFinite ? min(max(v, 0), 1) : Vol.def
    if let l = store.loadPrefs()?.link { link = l }
    if let a = store.loadPrefs()?.audio { audioPref = a }
    if let m = store.loadPrefs()?.mix { mix = m }
    for v in views {
      let slot = v.slot
      v.openSheet = { [weak self] spec in self?.sheet = Sheet(spec: spec, slot: slot) }
      v.objGone = { [weak self] id in
        guard let self else { return }
        self.core.lfoDrop(slot: slot, obj: id)
        if self.sheet?.slot == slot && self.sheet?.spec.lfo?.obj == id { self.sheet = nil }
      }
    }
  }

  // top — верхний inset (safe area); строка кнопок и мир считают от него
  func layout(W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H; self.top = top; self.safeBot = safeBot
    bar = TopBar(W: W, top: top)
    field = MapGeo.field(W: W, H: H, top: top, safeBot: safeBot)
    mixGeo = Mixer.geo(W: W, H: H, top: top, safeBot: safeBot)
    apGeo = AudioPanel.geo(bar: bar, W: W)
    cBox = Concordia.box(W: W, H: H, safeBot: safeBot, sunY: field.sy)
    for v in views.values { v.layout(W: W, H: H, topY: top + 44, safeBot: safeBot) }
  }

  // вход сразу, без перехода — только тесты и -shot (как t2d.go веба)
  func go(_ slot: Int) {
    guard views[slot] != nil else { return }
    nav.anim = nil; nav.view = .world(slot); lastSlot = slot
  }

  // ---------- касания ----------
  // на карте и в переходе все касания идут через MapGeo.hit на касании: вход / peek или съедено до подъёма (map.js navDown)
  private var onMap: Bool { nav.view == .map || nav.busy(now) }

  func down(_ f: Finger) {
    if onMap { routes[f.id] = mapDown(f) ?? .eat; return }
    let r = route(f)
    routes[f.id] = r
    switch r {
    case .btn(.vol): volF = (f.id, vol, f.y)
    case .panel(let k): panelDown(k)
    case .world(let s): touched.insert(s); views[s]?.down(f)
    case .sheet(let h): sheetDown(h, f)
    default: break
    }
  }

  private func mapDown(_ f: Finger) -> Route? {
    guard !nav.busy(now) else { return nil }               // во время перехода касания съедены
    if settings == .mixer { return mixerDown(f) }
    if settings != .off { settingsDown(f); return nil }    // открытые настройки забирают касание целиком
    switch MapGeo.hit(field, W: W, x: f.x, y: f.y) {
    case .world(let s): goWorld(s)
    case .peek(let c, let r): nav.peek = (now, c, r)
    case .sun: settings = .concordia
    case .eat: break
    }
    return nil
  }

  // mixDown: назад в concordia / mute / фейдер (с двойным тапом); фейдер ведётся до подъёма, где бы палец ни был
  private func mixerDown(_ f: Finger) -> Route? {
    switch Mixer.hit(mixGeo, x: f.x, y: f.y) {
    case .back: settings = .concordia
    case .none: break
    case .mute(let s): mix.mute[s] = mix.mute[s] != true; applyMix(); markPrefs()
    case .fader(let k):
      if let t = mixTap, t.key == k, now - t.t < Touch.dtapMs / 1000 {   // двойной тап — по умолчанию
        switch k { case .world(let s): mix.g[s] = nil; case .master(let m): mix[m] = m.def }
        applyMix(); markPrefs(); mixTap = nil
        break
      }
      mixTap = (k, now)
      switch k { case .world(let s): return .mix(k, mix.fader(s)); case .master(let m): return .mix(k, mix[m]) }
    }
    return nil
  }

  // микшер в ядро: фейдеры 12 миров и мастер (после каждой правки и при reinit)
  func applyMix() {
    for w in Worlds.all { core.fader(slot: w.slot, g: mix.gain(w.slot)) }
    let m = mix.master()
    core.master(lpf: m.lpf, thr: m.thr, ratio: m.ratio, ceil: m.ceil)
  }

  // строка — переключить или выполнить, мимо коробки — закрыть (concordia.js settingsDown)
  private func settingsDown(_ f: Finger) {
    guard Concordia.inside(cBox, x: f.x, y: f.y) else { settings = .off; return }
    switch Concordia.hit(cBox, x: f.x, y: f.y) {
    case .clock?: link.clock.toggle(); markPrefs()
    case .scale?: link.scale.toggle(); markPrefs()
    case .stable?: toggleStable()
    case .restart?: restartAudio()
    case .mixer?: settings = .mixer
    case nil: break
    }
  }

  // stable audio и restart audio — общие у concordia и панели audio
  private func toggleStable() {
    audioPref.stable.toggle(); markPrefs(); savePrefs()     // сразу: настройка нужна и после падения звука
    onStable?(audioPref.stable)
  }
  private func restartAudio() { restartAt = now; onRestart?() }

  // настройки (общие темп и лад, stable) изменились — запись через autosave секунд (tick) или в фон
  func markPrefs() { if prefsDirtyAt == nil { prefsDirtyAt = now } }
  private func savePrefs() {
    prefsDirtyAt = nil
    store.savePrefs(PrefsFile(vol: vol, mix: mix, link: link, audio: audioPref))
  }

  // действие строки панели — на касании (audio-panel.js panelDown)
  private func panelDown(_ k: AudioPanel.Key) {
    switch k {
    case .stop: press(.clr)                                  // без часов — заглушить мир, как корзина (отмена вернёт)
    case .restart: restartAudio()
    case .stable: toggleStable()
    case .tempo: break
    }
  }

  // тап по громкости — открыть или закрыть панель; повёл или держал — это была громкость.
  // t0 и touchTime — UITouch.timestamp, секунды (как Host.now): Touch.tapMs в мс
  private func volTap(_ f: Finger) {
    guard world != nil, !f.moved, hypot(f.x - f.x0, f.y - f.y0) < Touch.tapMove, (f.touchTime - f.t0) * 1000 < Touch.tapMs else { return }
    audioPanel.toggle()
  }

  // легенда → плашка → список ладов → верхняя строка → левый край (свайп на карту) → предмет-угол (на карту) → мир
  private func route(_ f: Finger) -> Route {
    guard let w = world else { return .eat }
    if audioPanel {                                          // панель открыта — первая: строка, закрыть, громкость как всегда
      switch AudioPanel.hit(apGeo, bar: bar, x: f.x, y: f.y) {
      case .vol: return .btn(.vol)
      case .close:                                           // мимо: закрыть и съесть; левая полоса — всё же свайп на карту
        audioPanel = false
        return f.x < Host.edgeW && f.y > top + 44 ? .edge : .eat
      case .none: return .eat
      case .row(.tempo): return .eat                         // часов у мира нет — съедено
      case .row(let k): return .panel(k)
      }
    }
    if legendOpen { return .title }
    if let s = sheet { return .sheet(sheetHit(s, geo(s), x: f.x, y: f.y, fxBtn: bar.pos(.rev))) }
    if sclOpen { return .list }
    switch bar.hit(f.x, f.y, titleW: titleW) {
    case .title: return .title
    case .btn(let b): return .btn(b)
    case nil: break
    }
    if f.x < Host.edgeW && f.y > top + 44 { return .edge }   // левая полоса под строкой — как headHit в вебе (EDGE_W = 14)
    return w.cornerHit(f.x, f.y) ? .corner : .world(w.slot)
  }

  func move(_ f: Finger) {
    guard let r = routes[f.id] else { return }
    switch r {
    case .world(let s): views[s]?.move(f)
    case .sheet(let h): sheetMove(h, f)
    case .btn(.vol):
      guard let d = volF, d.id == f.id else { return }
      vol = min(max(d.v0 - Double((f.y - d.y0) / Vol.travel), 0), 1)
      core.vol(Vol.gain(vol))
    case .mix(let k, let v0):
      let v = Mixer.value(mixGeo, v0: v0, dx: f.x - f.x0)
      switch k { case .world(let s): mix.g[s] = v; case .master(let m): mix[m] = v }
      applyMix()
    case .edge:
      let dx = f.x - f.x0, dy = f.y - f.y0
      if dx > Host.edgeDx && abs(dy) < Host.edgeSlope * dx { routes[f.id] = .eat; goMap() }
    default: break
    }
  }

  func up(_ f: Finger) {
    guard let r = routes.removeValue(forKey: f.id) else { return }
    switch r {
    case .world(let s): views[s]?.up(f)
    case .sheet(let h): sheetUp(h, f)
    case .title:
      if legendOpen { legendOpen = false }
      else if bar.hit(f.x, f.y, titleW: titleW) == .title { legendOpen = true }
    case .list: pick(bar.sclPick(f.x, f.y))
    case .btn(let b):
      if b == .vol { volF = nil; savePrefs(); volTap(f) }
      else if bar.hit(f.x, f.y, titleW: titleW) == .btn(b) { press(b) }
    case .corner: if world?.cornerHit(f.x, f.y) == true { goMap() }   // на подъёме с повторным попаданием, как кнопки
    case .mix: applyMix(); markPrefs()
    case .edge, .eat, .panel: break
    }
    endGesture()
  }

  // система отняла касание: действий нет, но жест кончился
  func cancel(_ f: Finger) {
    guard let r = routes.removeValue(forKey: f.id) else { return }
    if case .world(let s) = r { views[s]?.cancel(f) }
    if case .btn(.vol) = r { volF = nil; savePrefs() }
    if case .sheet = r { releaseSheet(f) }
    if case .mix = r { applyMix(); markPrefs() }
    endGesture()
  }

  // жест кончился, когда лёг последний палец: undo-снимок каждому миру, которого он касался
  private func endGesture() {
    guard routes.isEmpty else { return }
    var s = touched
    if let w = world { s.insert(w.slot) }
    touched = []
    for slot in s.sorted() { undo.commit(slot: slot, scl: scl) }
  }

  private func press(_ b: Btn) {
    guard let w = world else { return }
    switch b {
    case .scl: sclOpen = true
    case .dice: w.dice(); diceAt = now * 1000
    case .clr: w.clear()
    case .undo: undoStep()
    case .rev: if let fx = w.fx { sheet = Sheet(spec: fx, slot: w.slot) }
    case .back: goMap()
    case .vol: break
    }
  }

  // ---------- карта ↔ мир ----------
  private func closeOverlays() { audioPanel = false; sheet = nil; legendOpen = false; sclOpen = false; settings = .off }

  // тап по карточке: переход 520 мс; режим .world и tick мира — по концу (Nav.step)
  // internal — для теста; из кода зовёт тап по карточке
  func goWorld(_ slot: Int) {
    guard views[slot] != nil, !nav.busy(now) else { return }
    if !link.scale, let from = lastSlot, from != slot {     // лад не общий: у каждого мира свой (map.js goWorld)
      perScl[from] = scl
      if let s = perScl[slot] { scl = s; core.scale(s) }
    }
    lastSlot = slot; settings = .off
    nav.anim = (now, false, slot)
  }

  // internal — для теста; из кода зовут стрелка, угол и край. Звук мира не трогаем.
  func goMap() {
    guard case .world(let slot) = nav.view, let w = views[slot] else { return }
    closeOverlays()
    rowF = nil; padDepth = nil
    levels = Levels()                                        // лучи с нуля: первый опрос берёт настоящий rms, без призраков
    snaps[slot] = snapshot(w)
    touched.insert(slot)
    // пальцы мира остаются миру до подъёма; пальцы плашки, легенды, кнопок и выходов — съедены (громкость держится сама)
    for (id, r) in routes {
      switch r {
      case .world, .btn(.vol), .eat: break
      default: routes[id] = .eat
      }
    }
    nav.anim = (now, true, slot); nav.view = .map
  }

  // мир + верхняя строка в отдельный контекст W×H — так же, как фон Firmamentum (начало слева сверху, Draw.scale)
  private func snapshot(_ w: World) -> CGImage? {
    let sc = Draw.scale
    guard W > 0, H > 0, let g = CGContext(data: nil, width: Int((W * sc).rounded()), height: Int((H * sc).rounded()), bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue) else { return nil }
    g.translateBy(x: 0, y: CGFloat(g.height)); g.scaleBy(x: sc, y: -sc)
    let d = Draw(g: g, W: W, H: H); d.setTheme(w.theme)
    w.drawShot(d, now: now)
    bar.draw(d, barState(w), now: now * 1000)
    return g.makeImage()
  }

  // только -shot: замороженный переход / peek
  func shotFreeze(_ k: Double?) { nav.freeze = k }

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
    if core.lfoAdd(slot: s.slot, obj: l.obj, key: c, base: s.spec.get(k), shape: l.shape) {   // кольцо отбросило — не ждём
      pending[LfoKey(slot: s.slot, obj: l.obj, key: c)] = now
    }
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
    guard let w = world else { return }
    let r = undo.undo(slot: w.slot, cur: scl)
    guard r.done else { return }
    w.restored(); pending.removeAll()
    if let s = r.scl { scl = s; core.scale(s) }
    if let b = undo.last(slot: w.slot) { setScene(w.slot, b.w, b.scl) }   // undo.poll базу после undo не отдаёт
  }

  private func setScene(_ slot: Int, _ w: String, _ s: Scl) { scenes[slot] = (w, s); dirtyAt[slot] = now }

  // только -shot: состояние сцены без касаний (список ладов и легенда открываются жестом, снимку нужен готовый кадр)
  func shotState(scl s: Scl, sclOpen: Bool = false, legendOpen: Bool = false) {
    scl = s; core.scale(s)
    self.sclOpen = sclOpen; self.legendOpen = legendOpen
  }

  // только -shot: плашка открыта без касаний (FX мира или звезда id), при lfoKey — с панелью LFO этой строки
  func shotSheet(_ spec: SheetSpec, lfoKey: String? = nil) {
    guard let w = world else { return }
    let s = Sheet(spec: spec, slot: w.slot)
    sheet = s                                                // сначала плашка: её didSet чистит pending
    if let k = lfoKey { ensureLfo(s, k); s.lfoKey = k }
  }
  // только -shot: LFO строки 1 Гц, глубина 0.5 (как пад в веб-сценарии firmsheet); nil — строки нет
  func shotLfo(rate: Double, depth: Double) {
    guard let s = sheet, let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) else { return }
    core.lfoSpec(slot: s.slot, obj: l.obj, key: c, morph: .nan, rate: rate, depth: depth)
  }

  // ---------- кадр и сохранение ----------
  func tick(now: Double, dt: Double) {
    self.now = now
    _ = nav.step(now)                                        // закрыл кончившиеся переход и peek; по концу входа — режим .world
    if audioPanel && !onMap { levels.poll(now: now, read: core.levels) }   // в мире уровни — только для stop панели
    if onMap {                                               // карта и переход: мир не тикает
      levels.poll(now: now, read: core.levels)               // лучи карты — пока она видна
      for v in views.values { v.idle() }                     // слить кольца миров, чтобы вход не отыграл старое
    } else { world?.tick(now: now, dt: dt) }                 // мир тикает вне перехода
    if sheet != nil { lfos = core.lfoSnap() }
    for b in undo.pollAll() { setScene(b.slot, b.w, b.scl) }
    for (slot, t) in dirtyAt where now - t >= Host.autosave { saveScene(slot) }
    if let t = prefsDirtyAt, now - t >= Host.autosave { savePrefs() }
  }

  private func saveScene(_ slot: Int) {
    dirtyAt[slot] = nil
    if let s = scenes[slot] { store.saveScene(slot: slot, SceneFile(w: s.w, scl: s.scl)) }
  }

  // в фон: сразу сцены и prefs, таймеры сняты
  func background() {
    for b in undo.pollAll() { setScene(b.slot, b.w, b.scl) }  // ответ, пришедший без тика, иначе потеряется
    for slot in dirtyAt.keys.sorted() { saveScene(slot) }
    savePrefs()
  }

  // из Audio.onInit — после t2d_app_init (запуск и смена частоты): init стёр миры и сбросил громкость, лад остался.
  // Порядок: restore сцен всех миров, лад, громкость. Можно звать повторно. Режим (карта / мир) не трогает.
  func reapply() {
    let first = !started
    started = true
    for slot in slots {
      guard let w = views[slot] else { continue }
      if scenes[slot] == nil && !loaded.contains(slot), let f = store.loadScene(slot: slot) { scenes[slot] = (f.w, f.scl) }
      loaded.insert(slot)
      if let sc = scenes[slot] {
        core.restore(slot: slot, sc.w)
        if first { scl = sc.scl }                            // лад из файла — только при запуске; при reinit живой новее снимка
        w.restored()
      }
    }
    pending.removeAll()                                      // reinit ядра стирает LFO и без сцены
    core.scale(scl)
    core.vol(Vol.gain(vol))
    applyMix()
    // первый снимок после восстановления — база отмены (текст после restore может отличаться от сохранённого)
    for slot in slots { undo.base(slot: slot, w: nil, scl: scl); undo.commit(slot: slot, scl: scl) }
  }

  // ---------- рисование ----------
  private func barState(_ w: World) -> TopBar.State {
    TopBar.State(title: w.title, vol: vol, volHeld: volF != nil, scl: scl, sclOpen: sclOpen,
                 canUndo: undo.depth(slot: w.slot) > 0, fxArc: w.fx?.arc?(), fxHeld: fxHeld,
                 backHeld: held(.back), diceHeld: held(.dice), diceAt: diceAt)
  }

  // карта видна — в режиме .map и в переходе в обе стороны (до конца: снимок мира тает, карточки проявляются)
  func draw(_ d: Draw, now: Double) {
    if onMap {
      // только -shot: peek с замороженным k — время кадра подменяем (иначе он кончится за 420 мс)
      let t = nav.anim == nil ? nav.peek.flatMap { p in nav.freeze.map { p.t0 + $0 * Nav.peekDur } } ?? now : now
      MapDraw.draw(d, nav: nav, field: field, lv: levels.lv, snap: nav.anim.flatMap { snaps[$0.slot] }, settings: settings != .off, now: t)
      if settings == .concordia && !nav.busy(now) {
        Concordia.draw(d, cBox, link: link, stable: audioPref.stable, restartK: CGFloat(min(1, max(0, 1 - (now - restartAt) / 0.9))))
      }
      if settings == .mixer && !nav.busy(now) { Mixer.draw(d, mixGeo, mix: mix, lv: levels.lv) }
      return
    }
    guard let w = world else { return }
    d.setTheme(w.theme)                                      // MapDraw оставляет базовую
    w.draw(d, now: now)
    titleW = bar.draw(d, barState(w), now: now * 1000)
    if let s = sheet {
      var held: SheetHit?
      for r in routes.values { if case .sheet(let h) = r { held = h } }
      SheetDraw.draw(d, s, geo(s), lfos: lfos, held: held, sample: core.lfoSample)
    }
    if audioPanel {
      var held: AudioPanel.Key?
      for r in routes.values { if case .panel(let k) = r { held = k } }
      AudioPanel.draw(d, apGeo, stable: audioPref.stable, sounding: levels.lv[w.slot] > 0.0025, held: held,
                      restartK: CGFloat(min(1, max(0, 1 - (now - restartAt) / 0.9))))
    }
    if legendOpen { Legend.draw(d, title: "L E G E N D A", rows: w.legend, W: W, H: H, top: top, safeBot: safeBot) }
  }
}
