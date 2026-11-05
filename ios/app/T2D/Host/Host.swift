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
  private(set) var mix = Mix()                             // микшер: фейдеры миров, mute, мастер
  private var mixTap: (key: Mixer.Key, t: Double)?             // последний тап по строке: двойной — значение по умолчанию
  private(set) var link = Link()                           // общие темп и лад миров
  private(set) var audioPref = AudioPref()
  private(set) var restartAt = -Double.infinity            // когда последний раз перезапускали звук (с): вспышка «audio restarted» 0.9 с
  var onRestart: (() -> Void)?                             // ставит App: Audio.restart
  var onStable: ((Bool) -> Void)?                          // ставит App: Audio.stable
  var onMidi: ((Bool) -> Void)?                            // ставит App: Midi.on
  private(set) lazy var midiClock = MidiClock(core: core, follow: MidiFollow(worlds: { [unowned self] in self.views.values.compactMap(\.tempo) }, here: { [unowned self] in self.world?.tempo }), worlds: { [unowned self] in self.views.values.compactMap(\.tempo) })
  private var perScl: [Int: Scl] = [:]                     // свой лад у каждого мира, когда лад не общий (в памяти, как perScl веба)
  private var lastSlot: Int?                               // мир, в котором были последним
  private var prefsDirtyAt: Double?                        // настройки изменились; запись — через autosave секунд
  private(set) var scl = Scl.off {
    didSet { guard scl != oldValue else { return }; pushScale(); if link.scale { markPrefs() } }   // не общий — в prefs свой лад не пишем (там лад карты)
  }
  private var prefsScl = Scl.off                           // лад из prefs.json: общий (link.scale) и стартовый на карте
  private(set) var legendOpen = false
  var sclOpen: Bool { plate?.tab == .scale }
  private(set) var lastTab = PlateTab.fx                      // плашка открывается на вкладке, где закрыли
  private(set) var plate: Plate? {                            // плашка с вкладками: fx-вкладка держит Sheet мира
    didSet {
      if let p = plate, p.tab == .fx, oldValue?.tab != .fx, let w = world, let fx = w.fx { sheet = Sheet(spec: fx, slot: w.slot) }
      else if oldValue?.tab == .fx, plate?.tab != .fx { sheet = nil }
      if let p = plate { lastTab = p.tab }
    }
  }
  private(set) var sheet: Sheet? {                         // открытая плашка: забирает касания целиком
    didSet { lfos = sheet == nil ? [] : core.lfoSnap(); pending.removeAll() }   // снимок свежий с открытия
  }
  private(set) var lfos: [LfoSnap] = []                        // снимок LFO ядра: только пока открыта плашка (раз в кадр)
  private struct LfoKey: Hashable { var slot, obj, key: Int }
  private var pending: [LfoKey: Double] = [:]                  // lfoAdd послан, снимок ещё без него: когда послан (с) — не слать снова
  private static let pendingTTL = 0.25                         // дольше — считаем, что кольцо отбросило

  private var bar = TopBar(W: 0, top: 0)                    // нижний бар; safeBot хоста — уже с barH (миры, плашка, карта лежат над баром)
  private var W: CGFloat = 0, H: CGFloat = 0, top: CGFloat = 0, safeBot: CGFloat = 0
  private var titleW: CGFloat = 0                              // из последнего draw: нужна попаданию по заголовку
  private var now = 0.0
  static let masterDefault = 100.0                             // мастер ядра после init (Host::masterBpm)
  private var lastBpm: Double?                                 // последний темп, отправленный мастеру: init ядра его стирает
  private var diceAt = -1e9                                    // мс: кость крутится 400 мс после броска

  // у пальца, начатого на хосте, своя цель до подъёма — миру он не уходит
  private enum Route { case world(Int), btn(Btn), title, list(PlateGeo), mixRow(Mixer.Key?, Double), tr(Plate.TransportRow, Double), sheet(SheetHit), edge, corner, eat }
  private var routes: [ObjectIdentifier: Route] = [:]
  private var mixF: (id: ObjectIdentifier, mode: Int, scroll0: CGFloat)?   // палец на вкладке mix: 0 — не решил, 1 — фейдер, 2 — прокрутка
  func setMasterVol(_ v: Double) { vol = v; core.vol(Vol.gain(v)) }
  private var rowF: (id: ObjectIdentifier, key: String, v0: Double)?    // строка плашки в руках: база на момент касания
  private var padDepth: (id: ObjectIdentifier, d: Double)?                                        // последняя посланная глубина пада — для снятия на подъёме
  private func held(_ b: Btn) -> Bool { routes.values.contains { if case .btn(b) = $0 { return true } else { return false } } }
  var fxHeld: Bool { held(.fx) }
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
    prefsScl = store.loadPrefs()?.scl ?? .off
    if link.scale { scl = prefsScl }                       // лад общий: из prefs, лад из файлов сцен не берём
    for v in views {
      let slot = v.slot
      v.openSheet = { [weak self] spec in self?.sheet = Sheet(spec: spec, slot: slot) }
      v.objGone = { [weak self] id in
        guard let self else { return }
        self.core.lfoDrop(slot: slot, obj: id)
        if self.sheet?.slot == slot && (self.sheet?.spec.lfo?.obj == id || self.sheet?.spec.obj == id) { self.sheet = nil }
      }
      (v as? UndoCommitting)?.commitUndo = { [weak self] in
        guard let self else { return }
        self.undo.commit(slot: slot, scl: self.scl)
      }
      v.goMap = { [weak self] in self?.goMap() }
      v.tempo?.tempoSet = { [weak self] b in self?.tempoFrom(slot: slot, b) }
      v.lfoBase = { [weak self] obj, code in    // свежий снимок ядра, не lfos плашки
        guard let b = self?.core.lfoSnap().first(where: { $0.slot == slot && $0.obj == obj && $0.key == code })?.base, b.isFinite else { return nil }
        return b
      }
      v.rowLfoOff = { [weak self] code in
        guard let self else { return }
        self.core.lfoOff(slot: slot, obj: -1, key: code)
        self.pending[LfoKey(slot: slot, obj: -1, key: code)] = nil
      }
    }
    pushScale()                                            // didSet в init не срабатывает: мирам — текущий лад один раз
  }

  // лад миру: ноты по модулю 12 от A ((ступень + тоника) % 12, как scalePCs веба); nil — выключен
  private func pushScale() {
    var pcs: [Int]? = nil
    if scl.on { let st = core.scaleSteps(scl.idx); if !st.isEmpty { pcs = st.map { ($0 + scl.root) % 12 } } }
    let root = scl.on ? scl.root : 0
    for v in views.values { v.scale(pcs: pcs, root: root) }
  }

  // top — верхний inset (safe area); строка кнопок и мир считают от него
  func layout(W: CGFloat, H: CGFloat, top: CGFloat, safeBot: CGFloat) {
    self.W = W; self.H = H; self.top = top; self.safeBot = safeBot + TopBar.barH
    bar = TopBar(W: W, top: top, H: H, safeBot: safeBot)
    field = MapGeo.field(W: W, H: H, top: top, safeBot: self.safeBot)
    for v in views.values { v.layout(W: W, H: H, topY: top + 44, safeBot: self.safeBot) }
  }

  // вход сразу, без перехода — только тесты и -shot (как t2d.go веба)
  func go(_ slot: Int) {
    guard views[slot] != nil else { return }
    nav.anim = nil; nav.view = .world(slot); lastSlot = slot
    views[slot]?.enter()
  }

  // ---------- касания ----------
  // на карте и в переходе все касания идут через MapGeo.hit на касании: вход / peek или съедено до подъёма (map.js navDown)
  private var onMap: Bool { nav.view == .map || nav.busy(now) }

  func down(_ f: Finger) {
    let r = onMap ? (mapDown(f) ?? .eat) : route(f)
    routes[f.id] = r
    switch r {
    case .world(let s): touched.insert(s); views[s]?.down(f)
    case .sheet(let h): sheetDown(h, f)
    default: break
    }
  }

  private func mapDown(_ f: Finger) -> Route? {
    guard !nav.busy(now) else { return nil }               // во время перехода касания съедены
    if plate != nil { return plateRoute(f) }
    switch bar.hit(f.x, f.y, titleW: 0, enabled: mapEnabled) {
    case .btn(let b): return .btn(b)
    case .title: return nil                                // имя карты — не кнопка
    case nil: break
    }
    switch MapGeo.hit(field, W: W, x: f.x, y: f.y) {
    case .world(let s): goWorld(s)
    case .peek(let c, let r): nav.peek = (now, c, r)
    case .eat: break
    }
    return nil
  }

  // ручка темпа любого мира → мастер ядра и setBpm у остальных миров с часами, каждому в его диапазоне (host/tempo.js tempoFrom).
  // Внешний MIDI ведёт темп сам, мастер ручной игнорирует — молчим, чтобы модели не показывали неправду
  func tempoFrom(slot: Int, _ bpm: Double) {
    guard core.grid() == nil else { return }
    lastBpm = bpm
    core.setMasterBpm(bpm)
    for (s, v) in views where s != slot { if let t = v.tempo { t.setBpm(min(max(bpm, t.tempoRange.lowerBound), t.tempoRange.upperBound)) } }
  }

  // модели ← мастер (только отображение, мастер не трогаем): после reinit ядра, undo и кубика (host/tempo.js syncModelsToMaster)
  func syncModelsToMaster() {
    guard core.grid() == nil else { return }
    let bpm = lastBpm ?? Self.masterDefault
    for (_, v) in views { if let t = v.tempo { t.setBpm(min(max(bpm, t.tempoRange.lowerBound), t.tempoRange.upperBound)) } }
  }

  // микшер в ядро: фейдеры 12 миров и мастер (после каждой правки и при reinit)
  func applyMix() {
    for w in Worlds.all { core.fader(slot: w.slot, g: mix.gain(w.slot)) }
    let m = mix.master()
    core.master(lpf: m.lpf, thr: m.thr, ratio: m.ratio, ceil: m.ceil)
  }

  // stable audio и restart audio — общие у concordia и панели audio
  func toggleStable() {
    audioPref.stable.toggle(); markPrefs(); savePrefs()     // сразу: настройка нужна и после падения звука
    restartAt = now                                         // как в вебе: смена буфера перезапускает звук — вспышка «audio restarted»
    onStable?(audioPref.stable)
  }
  // midi clock: слушать часы системы (CoreMIDI → ядро → MidiClock → миры)
  func toggleMidi() {
    audioPref.midi.toggle(); markPrefs(); savePrefs()
    midiClock.on = audioPref.midi
    onMidi?(audioPref.midi)
  }
  func restartAudio() { restartAt = now; onRestart?() }

  // настройки (общие темп и лад, stable) изменились — запись через autosave секунд (tick) или в фон
  func markPrefs() { if prefsDirtyAt == nil { prefsDirtyAt = now } }
  private func savePrefs() {
    prefsDirtyAt = nil
    store.savePrefs(PrefsFile(vol: vol, mix: mix, link: link, audio: audioPref, scl: scl))
  }


  // легенда → плашка → список ладов → верхняя строка → предмет-угол (на карту) → левый край (свайп на карту) → мир
  private func route(_ f: Finger) -> Route {
    guard let w = world else { return .eat }
    if legendOpen { return .title }
    if plate != nil { return plateRoute(f) }
    if let s = sheet { return .sheet(sheetHit(s, geo(s), x: f.x, y: f.y, fxBtn: bar.pos(.fx))) }
    switch bar.hit(f.x, f.y, titleW: titleW, enabled: barEnabled) {
    case .title: return .title
    case .btn(let b): return .btn(b)
    case nil: break
    }
    if w.cornerHit(f.x, f.y) { return .corner }              // предмет-угол раньше левой полосы — порядок headHit веба (ui-top.js:41-46): солнце Tenebrae у самого края
    if f.x < Host.edgeW && f.y > top + 44 { return .edge }   // левая полоса под строкой — как headHit в вебе (EDGE_W = 14)
    return .world(w.slot)
  }

  func move(_ f: Finger) {
    guard let r = routes[f.id] else { return }
    switch r {
    case .world(let s): views[s]?.move(f)
    case .sheet(let h): sheetMove(h, f)
    case .tr(let r, let v0): if r == .bpm { bpmMove(f, v0) }
    case .mixRow(let k, let v0): mixTabMove(f, k, v0)
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
    case .list(let g): pick(Plate.sclPick(g, x: f.x, y: f.y))
    case .btn(let b):
      if hitsBtn(f, b) { press(b) }
    case .tr(let r, _): if r != .bpm, hypot(f.x - f.x0, f.y - f.y0) <= Touch.tapMove, plate.map({ Plate.transportHit(plateGeo($0), x: f.x, y: f.y) == r }) == true { transportAct(r) }
    case .corner: if world?.cornerHit(f.x, f.y) == true { goMap() }   // на подъёме с повторным попаданием, как кнопки
    case .mixRow(let k, _): if mixF?.mode == 1 { applyMix(); markPrefs(); if k == .volume { savePrefs() } }; mixF = nil   // громкость мастера — сразу, как раньше жест vol
    case .edge, .eat: break
    }
    endGesture()
  }

  // система отняла касание: действий нет, но жест кончился
  func cancel(_ f: Finger) {
    guard let r = routes.removeValue(forKey: f.id) else { return }
    if case .world(let s) = r { views[s]?.cancel(f) }
    if case .sheet = r { releaseSheet(f) }
    if case .mixRow = r { if mixF?.mode == 1 { applyMix(); markPrefs() }; mixF = nil }
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


  // ---------- хедер на карте ----------
  private var recycleStash: [(slot: Int, w: String, scl: Scl)]?   // состояния миров до последнего recycle на карте; один шаг отмены
  private var mapEnabled: Set<Btn> { [.play, .transport, .vol, .fx] }
  // кнопки бара, которые ловят касание: на карте — mapEnabled; в мире без часов play погашен
  private var barEnabled: Set<Btn> { onMap ? mapEnabled : Set(Btn.allCases) }
  private func hitsBtn(_ f: Finger, _ b: Btn) -> Bool { bar.hit(f.x, f.y, titleW: onMap ? 0 : titleW, enabled: barEnabled) == .btn(b) }

  func mapBarState() -> TopBar.State {
    var st = TopBar.State(title: "Universum", held: heldBtns)
    st.enabled = mapEnabled
    st.playing = mapPlaying
    return st
  }
  private var heldBtns: Set<Btn> { Set(Btn.allCases.filter { held($0) }) }

  // recycle на карте: очистить все миры. Состояния до очистки — в recycleStash (база отмены каждого мира);
  // нет базы хотя бы у одного — ничего не очищаем, иначе отмена потеряла бы мир
  @discardableResult func recycleAll(_ only: [Int]? = nil) -> Bool {
    let targets = only ?? slots
    for b in undo.pollAll() { setScene(b.slot, b.w, b.scl) }
    // на карте миры не правятся, поэтому миры из прежнего запаса остаются очищенными — их состояние до очистки не затираем
    var stash = recycleStash ?? []
    for slot in targets where !stash.contains(where: { $0.slot == slot }) {
      if let b = undo.last(slot: slot) { stash.append((slot, b.w, b.scl)) }   // базы ещё нет — очищаем без возврата, но очищаем
    }
    for slot in targets { views[slot]?.clear() }
    cleared.formUnion(targets)
    recycleStash = stash.isEmpty ? nil : stash
    for slot in targets { undo.commit(slot: slot, scl: link.scale ? scl : (perScl[slot] ?? scl)) }   // сцены и базы — уже очищенные
    return true
  }

  // undo на карте: вернуть миры, какими были до recycle; не вернулся мир (кольцо полно) — остаётся в запасе
  @discardableResult func undoRecycle() -> Bool {
    guard let st = recycleStash else { return false }
    var left: [(slot: Int, w: String, scl: Scl)] = []
    for e in st {
      if core.restore(slot: e.slot, e.w) {
        views[e.slot]?.restored(); undo.base(slot: e.slot, w: e.w, scl: e.scl); setScene(e.slot, e.w, e.scl)
        cleared.remove(e.slot)
      } else { left.append(e) }
    }
    recycleStash = left.isEmpty ? nil : left
    syncModelsToMaster()
    return left.isEmpty
  }

  private func pressMap(_ b: Btn) {
    switch b {
    case .play: transportAct(.play)
    case .transport: togglePlate(.transport)
    case .vol: togglePlate(.mix)
    case .fx: togglePlate(.fx)
    case .back: break
    }
  }

  private func press(_ b: Btn) {
    if onMap { pressMap(b); return }
    switch b {
    case .back: goMap()
    case .play: transportAct(.play)
    case .transport: togglePlate(.transport)
    case .vol: togglePlate(.mix)
    case .fx: togglePlate(.fx)
    }
  }

  // play на карте: идут часы — стоп им и тишина мирам без часов (Oceanus, Tenebrae…); иначе — пуск часов
  private var cleared: Set<Int> = []                 // миры, очищенные корзиной, пока в них не вошли заново
  private var mapPlaying: Bool { views.values.contains { $0.tempo?.playing == true } }
  private func mapPlay() {
    if mapPlaying {
      for v in views.values { v.tempo?.play(false) }
      let silent = slots.filter { views[$0]?.tempo == nil }
      if !silent.isEmpty { recycleAll(silent) }
    } else {
      for (slot, v) in views where !cleared.contains(slot) { v.tempo?.play(true) }   // очищенный мир не заводим: Monochordum со страмом по умолчанию заиграл бы пустым
    }
  }

  // строки вкладки transport и кнопка play: один путь для карты и мира
  func transportAct(_ r: Plate.TransportRow) {
    if onMap {
      switch r {
      case .play: mapPlay()
      case .undo: undoRecycle()
      case .recycle: recycleAll()
      case .bpm, .dice: break
      }
      return
    }
    guard let w = world else { return }
    switch r {
    case .play: if let t = w.tempo { t.play(!t.playing) } else { w.clear() }   // нет часов — заглушить мир (веб: audio-panel stop), отмена вернёт
    case .dice: w.dice(); diceAt = now * 1000; syncModelsToMaster()
    case .undo: undoStep()
    case .recycle: w.clear(); cleared.insert(w.slot)
    case .bpm: break
    }
  }

  // темп: фейдер вкладки transport; карта — общий темп всех миров, мир — его диапазон
  private func bpmMove(_ f: Finger, _ v0: Double) {
    guard core.grid() == nil, let p = plate else { return }
    let g = plateGeo(p), dx = Double((f.x - f.x0) / (g.mixTx1 - g.mixTx0))
    if onMap {
      let c = min(max((v0 + dx * 160).rounded(), 40), 200)
      if c != lastBpm { tempoFrom(slot: -1, c); for case let t? in views.values.map(\.tempo) { t.setBpm(min(max(c, t.tempoRange.lowerBound), t.tempoRange.upperBound)) } }
    } else if let t = world?.tempo, let w = world {
      let lo = t.tempoRange.lowerBound, hi = t.tempoRange.upperBound
      let b = min(max((v0 + dx * (hi - lo)).rounded(), lo), hi)
      if b != t.bpm { t.setBpm(b); tempoFrom(slot: w.slot, b) }
    }
  }

  func transportState() -> TransportState {
    var t = TransportState()
    t.diceSpin = now * 1000 - diceAt < 400
    if onMap {
      t.playing = mapPlaying
      t.bpm = lastBpm ?? Host.masterDefault; t.canUndo = recycleStash != nil; t.diceOn = false
    } else if let w = world {
      t.playing = w.tempo?.playing ?? true
      if let tp = w.tempo { t.bpm = tp.bpm; t.range = tp.tempoRange }
      t.canUndo = undo.depth(slot: w.slot) > 0
    }
    return t
  }

  // ---------- плашка с вкладками ----------
  private var plateTabs: [PlateTab] { Plate.tabs(hasFx: world?.fx != nil, onMap: onMap) }
  func openPlate() {
    let t = plateTabs
    plate = Plate(tab: t.contains(lastTab) ? lastTab : t.contains(.scale) ? .scale : t[0])
  }
  // кнопка бара: вкладка открыта — закрыть; другая — переключить; закрыта — открыть (нет такой вкладки — как lastTab)
  func togglePlate(_ tab: PlateTab) {
    if plate?.tab == tab { plate = nil; return }
    if plateTabs.contains(tab) { plate = Plate(tab: tab) } else if plate == nil { openPlate() } else { plate = nil }
  }
  func selectTab(_ t: PlateTab) { if plateTabs.contains(t), plate?.tab != t { plate = Plate(tab: t) } }

  private func plateGeo(_ p: Plate) -> PlateGeo {
    var rows = 0, extra: CGFloat = 0
    if p.tab == .fx, let s = sheet { rows = s.spec.rows.count; extra = s.spec.lfo != nil && s.lfoKey != nil ? 196 : 0 }
    return PlateGeo.make(p, W: W, H: H, safeBot: safeBot, rows: rows, extra: extra, tabs: plateTabs)
  }

  // касание при открытой плашке: вкладка — переключить, мимо — закрыть, содержимое — fx (Sheet) или лад
  private func plateRoute(_ f: Finger) -> Route {
    guard let p = plate else { return .eat }
    let g = plateGeo(p)
    if case .btn(let b)? = bar.hit(f.x, f.y, titleW: 0, enabled: barEnabled), b != .back || !onMap { return .btn(b) }   // кнопки бара работают и при плашке
    switch Plate.hit(g, x: f.x, y: f.y) {
    case .close: plate = nil; return .eat
    case .tab(let t): selectTab(t); return .eat
    case .none: return .eat
    case .content:
      if p.tab == .fx, let s = sheet { return .sheet(sheetHit(s, geo(s), x: f.x, y: f.y, fxBtn: bar.pos(.fx))) }
      if p.tab == .scale { return .list(g) }
      if p.tab == .sys { sysDown(Plate.sysHit(g, x: f.x, y: f.y)); return .eat }
      if p.tab == .transport { return Plate.transportHit(g, x: f.x, y: f.y).map { .tr($0, onMap ? (lastBpm ?? Host.masterDefault) : (world?.tempo?.bpm ?? 0)) } ?? .eat }
      return p.tab == .mix ? mixTabDown(f, p, g) : .eat
    }
  }

  private func sysDown(_ r: Plate.SysRow?) {
    switch r {
    case .scale?: link.scale.toggle(); markPrefs()
    case .stable?: toggleStable()
    case .restart?: restartAudio()
    case .midi?: toggleMidi()
    case .tempo?, nil: break                               // темп общий всегда — строка неактивна
    }
  }

  private var mixKeys: [Mixer.Key] { Mixer.rows(current: onMap ? nil : world?.slot) }
  // mute и двойной тап — сразу; иначе ждём первое смещение: вертикаль — скролл, горизонталь — фейдер
  private func mixTabDown(_ f: Finger, _ p: Plate, _ g: PlateGeo) -> Route {
    mixF = (f.id, 0, p.scroll)
    switch Plate.mixHit(g, scroll: p.scroll, keys: mixKeys, x: f.x, y: f.y) {
    case .mute(let s): mix.mute[s] = mix.mute[s] != true; applyMix(); markPrefs(); mixF = nil; return .eat
    case .none: return .mixRow(nil, 0)
    case .fader(let k):
      if let t = mixTap, t.key == k, now - t.t < Touch.dtapMs / 1000 {
        switch k { case .world(let s): mix.g[s] = nil; case .volume: setMasterVol(Vol.def); case .master(let m): mix[m] = m.def }
        applyMix(); markPrefs(); mixTap = nil; mixF = nil
        return .eat
      }
      mixTap = (k, now)
      switch k { case .world(let s): return .mixRow(k, mix.fader(s)); case .volume: return .mixRow(k, vol); case .master(let m): return .mixRow(k, mix[m]) }
    }
  }

  private func mixTabMove(_ f: Finger, _ k: Mixer.Key?, _ v0: Double) {
    guard var d = mixF, d.id == f.id, let p = plate else { return }
    let dx = f.x - f.x0, dy = f.y - f.y0
    if d.mode == 0 {
      guard hypot(dx, dy) > Touch.slop else { return }
      d.mode = abs(dx) > abs(dy) && k != nil ? 1 : 2; mixF = d
    }
    if d.mode == 1, let k {
      let g = plateGeo(p), v = Mixer.slide(v0, dx, span: g.mixTx1 - g.mixTx0)
      switch k { case .world(let s): mix.g[s] = v; case .volume: setMasterVol(v); case .master(let m): mix[m] = v }
      applyMix()
    } else if d.mode == 2 {
      plate?.scroll = min(max(d.scroll0 - dy, 0), Plate.maxScroll(rows: mixKeys.count))
    }
  }

  // ---------- карта ↔ мир ----------
  private func closeOverlays() { plate = nil; sheet = nil; legendOpen = false }

  // тап по карточке: переход 520 мс; режим .world и tick мира — по концу (Nav.step)
  // internal — для теста; из кода зовёт тап по карточке
  func goWorld(_ slot: Int) {
    guard views[slot] != nil, !nav.busy(now) else { return }
    if !link.scale, lastSlot != slot {                      // лад не общий: у каждого мира свой (map.js goWorld); первый вход тоже
      if let from = lastSlot { perScl[from] = scl }
      if let s = perScl[slot] { scl = s; core.scale(s) }
    }
    lastSlot = slot; recycleStash = nil; plate = nil; cleared.remove(slot)
    views[slot]?.enter()
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
    case .close: plate = nil; sheet = nil
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
    if case .row(let k) = h, let r = rowF, r.id == f.id, r.key == k, let s = sheet, let tap = s.spec.tap,
       !f.moved, hypot(f.x - f.x0, f.y - f.y0) < Touch.tapMove, (f.touchTime - f.t0) * 1000 < Touch.tapMs { tap(k) }
    releaseSheet(f)
    guard let s = sheet, h == .pad, let d = pd, d < 0.03, let k = s.lfoKey, let l = s.spec.lfo, let c = code(s, k) else { return }
    core.lfoOff(slot: s.slot, obj: l.obj, key: c); pending[LfoKey(slot: s.slot, obj: l.obj, key: c)] = nil     // глубина в ноль — LFO снимается (sheet.js:81)
  }

  // выбор в списке — по подъёму (задержку веба на смену строки не переносим); список остаётся — можно выбрать и тонику
  private func pick(_ p: SclPick) {
    var s = scl
    switch p {
    case .outside: return                                  // мимо строк плашки — ничего
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
    syncModelsToMaster()
    if let s = r.scl { scl = s; core.scale(s) }
    if let b = undo.last(slot: w.slot) { setScene(w.slot, b.w, b.scl) }   // undo.poll базу после undo не отдаёт
  }

  private func setScene(_ slot: Int, _ w: String, _ s: Scl) { scenes[slot] = (w, s); dirtyAt[slot] = now }

  // только -shot: состояние сцены без касаний (список ладов и легенда открываются жестом, снимку нужен готовый кадр)
  func shotState(scl s: Scl, sclOpen: Bool = false, legendOpen: Bool = false) {
    scl = s; core.scale(s)
    plate = sclOpen ? Plate(tab: .scale) : nil; self.legendOpen = legendOpen
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
    if plate?.tab == .mix || onMap { levels.poll(now: now, read: core.levels) }   // лучи карты и уровни вкладки mix
    if onMap {                                               // карта и переход: мир не тикает
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
        if first && !link.scale { perScl[slot] = sc.scl }    // лад не общий: свой у мира из его сцены, только при запуске; при reinit живой новее
        w.restored()
      }
    }
    if first && !link.scale {                                // старт в мире — его лад, на карте — из prefs
      if case .world(let slot) = nav.view, let s = perScl[slot] { scl = s } else { scl = prefsScl }
    }
    pending.removeAll()                                      // reinit ядра стирает LFO и без сцены
    if let b = lastBpm { core.setMasterBpm(b) }              // t2d_app_init сбросил мастер в 100 — вернуть последний
    syncModelsToMaster()                                     // сцены вернули прежние bpm моделей — показывать мастер
    core.scale(scl)
    core.vol(Vol.gain(vol))
    applyMix()
    // первый снимок после восстановления — база отмены (текст после restore может отличаться от сохранённого)
    // лад не общий: у каждого мира свой (у текущего — живой), иначе сцены чужих миров перепишутся ладом карты
    var curSlot: Int? = nil
    if case .world(let c) = nav.view { curSlot = c }
    for slot in slots {
      let s = (!link.scale && slot != curSlot) ? (perScl[slot] ?? scl) : scl
      undo.base(slot: slot, w: nil, scl: s); undo.commit(slot: slot, scl: s)
    }
    if let c = curSlot { views[c]?.enter() }                 // init ядра сбросил «проснулся» (веб: restartAudio → enter)
    if audioPref.midi { midiClock.on = true }
  }

  // ---------- рисование ----------
  // снимок мира в переходе — для слоя Stage.snapLayer; nil — слой скрыт (первый вход: снимка ещё нет, карточки тают сами)
  func transitionSnap(now: Double) -> (image: CGImage, rect: CGRect, alpha: CGFloat)? {
    guard onMap, let slot = nav.anim?.slot, let im = snaps[slot],
          let f = MapDraw.snapFrame(nav: nav, field: field, W: W, H: H, now: now) else { return nil }
    return (im, f.rect, f.alpha)
  }

  func barState(_ w: World) -> TopBar.State {
    var st = TopBar.State(title: w.title, held: heldBtns)
    st.playing = w.tempo?.playing ?? true
    st.enabled = barEnabled
    return st
  }

  // карта видна — в режиме .map и в переходе в обе стороны (до конца: снимок мира тает, карточки проявляются)
  private func drawPlate(_ d: Draw, _ p: Plate, _ now: Double) {
    PlateDraw.draw(d, p, plateGeo(p), scl: scl, mix: mix, lv: levels.lv, current: onMap ? nil : world?.slot,
                   link: link, audio: audioPref, restartK: CGFloat(min(1, max(0, 1 - (now - restartAt) / 0.9))), tr: transportState(), vol: vol)
  }

  func draw(_ d: Draw, now: Double) {
    if onMap {
      // только -shot: peek с замороженным k — время кадра подменяем (иначе он кончится за 420 мс)
      let t = nav.anim == nil ? nav.peek.flatMap { p in nav.freeze.map { p.t0 + $0 * Nav.peekDur } } ?? now : now
      MapDraw.draw(d, nav: nav, field: field, lv: levels.lv, now: t)
      if !nav.busy(now) { bar.draw(d, mapBarState(), now: now * 1000); if let p = plate { drawPlate(d, p, now) } }
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
    if let p = plate { drawPlate(d, p, now) }
    if legendOpen { Legend.draw(d, title: "L E G E N D A", rows: w.legend, W: W, H: H, top: top, safeBot: safeBot) }
  }
}
