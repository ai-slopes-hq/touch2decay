import SwiftUI

// -shot <сцена>: снимок сцены для shot.sh. Сцены:
//   firmamentum (по умолчанию) | topbar | scales | legend | sheet | starsheet | lfo | undo — сначала host.go(10): вход в Firmamentum без перехода;
//   map — старт на карте, через 2 с кубик в Firmamentum (через ядро, без входа): к снимку (5 с) у его карточки лучи;
//   nav — go(10), кубик, через 2 с тап по стрелке назад (выход), переход заморожен на k = 0.5;
//   peek — тап по карточке Cymatica (лицо без вида), peek заморожен на середине («nondum»);
//   concordia — тап по солнцу на карте; mixer — карта → солнце → строка mixer, фейдер Arcadia сдвинут влево и мир заглушён (как nav-mixer-set веба);
//   audio — go(10), через 1 с тап по кнопке громкости: панель audio;
//   monochord | monochord-sheet | monochord-earth-sheet | monochord-wind | monochord-fan — go(7), см. shotMono;
//   horologium | horologium-ring-sheet | horologium-hub-sheet | horologium-fan | horologium-spin — go(9), см. shotHoro.
//   arcadia | arcadia-land | arcadia-held | arcadia-held-rim | arcadia-sheet | arcadia-fan — go(12), см. shotArc;
//   tria | tria-lux | tria-fall | tria-held | tria-sheet | tria-fan — go(11), см. shotTria;
//   inferno | inferno-held | inferno-sheet | inferno-fx | inferno-storm | inferno-fan — go(5), см. shotInferno;
//   natura | natura-play | natura-fx | natura-res | natura-skiff | natura-ducks-away | natura-sheet | natura-menu — go(4), см. shotNatura;
//   portus | portus-empty | portus-play | portus-echo | portus-star | portus-bloodmoon | portus-sheet — go(13), см. shotPortus;
//   cymatica | cym-empty | cym-play | cym-pinch | cym-steprec | cym-chance | cym-drift | cym-luna — go(2), см. shotCymatica;
//   tenebrae | ten-empty | ten-sun | ten-hole | ten-hold | ten-lfo | ten-ring | ten-zoom | ten-scale — go(1), см. shotTenebrae.
@main
struct T2DApp: App {
  // -shot firmamentum: зерно 7 (init ядра — до запуска движка, в Audio.start) и сцена для снимка
  private static let shot = CommandLine.arguments.contains("-shot")
  // имя сцены после -shot: firmamentum (по умолчанию) | topbar | scales | legend | sheet | starsheet | lfo
  private static let shotName: String = {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: "-shot"), i + 1 < a.count else { return "firmamentum" }
    return a[i + 1]
  }()
  @State private var audio: Audio
  @State private var world: FirmamentumView          // нужен только -shot (плашка звезды); Host держит миры сам
  @State private var ocean: OceanusView              // нужен только -shot oceanus*; Host держит миры сам
  @State private var mono: MonochordView             // нужен только -shot monochord*; Host держит миры сам
  @State private var horo: HorologiumView            // нужен только -shot horologium*; Host держит миры сам
  @State private var arc: ArcadiaView                // нужен только -shot arcadia*; Host держит миры сам
  @State private var tria: TriaView                  // нужен только -shot tria*; Host держит миры сам
  @State private var inf: InfernoView                // нужен только -shot inferno*; Host держит миры сам
  @State private var nat: NaturaView                 // нужен только -shot natura*; Host держит миры сам
  @State private var por: PortusView                 // нужен только -shot portus*; Host держит миры сам
  @State private var cym: CymaticaView               // нужен только -shot cym*; Host держит миры сам
  @State private var ten: TenebraeView               // нужен только -shot ten*; Host держит миры сам
  @State private var host: Host

  // миры с нативным видом — по реестру; шрифты в Info.plist (UIAppFonts) подхвачены до первого кадра, раньше первой карты
  private static func makeView(_ slot: Int) -> World? {
    switch slot {
    case TenebraeView.slotN: return TenebraeView(core: AppCore(slot: slot))
    case FirmamentumView.slotN: return FirmamentumView(core: AppCore(slot: slot), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34))
    case OceanusView.slotN:
      return OceanusView(core: AppCore(slot: slot), geo: OceanGeo(W: 390, H: 844, topY: 59, safeBot: 34),
                         readMirror: OceanusView.appMirror)
    case MonochordView.slotN: return MonochordView(core: AppCore(slot: slot))
    case HorologiumView.slotN: return HorologiumView(core: AppCore(slot: slot))
    case ArcadiaView.slotN: return ArcadiaView(core: AppCore(slot: slot))
    case TriaView.slotN: return TriaView(core: AppCore(slot: slot))
    case InfernoView.slotN: return InfernoView(core: AppCore(slot: slot))
    case NaturaView.slotN: return NaturaView(core: AppCore(slot: slot))
    case PortusView.slotN: return PortusView(core: AppCore(slot: slot))
    case CymaticaView.slotN: return CymaticaView(core: AppCore(slot: slot))
    default: return nil
    }
  }

  init() {
    let views = Worlds.all.filter(\.view).compactMap { T2DApp.makeView($0.slot) }
    let watch = views.reduce(UInt32(0)) { $0 | (1 << UInt32($1.slot)) }
    let a = Audio(log: .shared, seed: T2DApp.shot ? 7 : 1, watch: watch)
    a.probe = T2DApp.shot && T2DApp.shotName == "lfo"
    let h = Host(views: views, core: AppHostCore(), store: Store(dir: T2DApp.storeDir(), log: { Log.shared.add("store", $0) }))
    let midi = Midi()                                       // CoreMIDI → кольцо ядра; часы разбирает ядро, политику ведёт Host.midiClock
    a.onInit = { h.reapply(); midi.on = h.audioPref.midi }   // после t2d_app_init: до него кольцо ядра не готово
    a.stable = h.audioPref.stable                           // до start(): буфер берётся при запуске
    h.onRestart = { a.restart() }; h.onStable = { a.stable = $0 }
    h.onMidi = { midi.on = $0 }
    _audio = State(initialValue: a); _world = State(initialValue: views.compactMap { $0 as? FirmamentumView }[0]); _ocean = State(initialValue: views.compactMap { $0 as? OceanusView }[0]); _mono = State(initialValue: views.compactMap { $0 as? MonochordView }[0]); _horo = State(initialValue: views.compactMap { $0 as? HorologiumView }[0]); _arc = State(initialValue: views.compactMap { $0 as? ArcadiaView }[0]); _tria = State(initialValue: views.compactMap { $0 as? TriaView }[0]); _inf = State(initialValue: views.compactMap { $0 as? InfernoView }[0]); _nat = State(initialValue: views.compactMap { $0 as? NaturaView }[0]); _por = State(initialValue: views.compactMap { $0 as? PortusView }[0]); _cym = State(initialValue: views.compactMap { $0 as? CymaticaView }[0]); _ten = State(initialValue: views.compactMap { $0 as? TenebraeView }[0]); _host = State(initialValue: h)
  }

  var body: some Scene {
    WindowGroup {
      StageView(host: host, audio: audio).ignoresSafeArea().background(Color.black)
        .onAppear { audio.start(); UIApplication.shared.isIdleTimerDisabled = true; if T2DApp.shot { shotScene() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in host.background() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in UIApplication.shared.isIdleTimerDisabled = true }
    }
  }

  // Application Support/T2D; для -shot — пустая временная папка: снимок не зависит от сохранённой сцены и ничего не затирает
  private static func storeDir() -> URL {
    if shot { return FileManager.default.temporaryDirectory.appendingPathComponent("t2d-shot-\(UUID().uuidString)") }
    return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("T2D")
  }

  // undo — своя сцена; плашки — только кубик, плашка через 2.5 с; иначе dice, fx scintilla/drift/cometa, комета, через 1.8 с — crepitus и fulgur
  private func shotScene() {
    switch T2DApp.shotName {
    case "map": shotMap(); return
    case "nav": shotNav(); return
    case "peek": shotPeek(); return
    case "concordia", "mixer": shotConcordia(mixer: T2DApp.shotName == "mixer"); return
    case "audio": shotAudio(); return
    case "oceanus", "oceanus-sheet", "oceanus-luna", "oceanus-fan": shotOcean(T2DApp.shotName); return
    case "monochord", "monochord-sheet", "monochord-earth-sheet", "monochord-wind", "monochord-fan": shotMono(T2DApp.shotName); return
    case "horologium", "horologium-ring-sheet", "horologium-hub-sheet", "horologium-fan", "horologium-spin": shotHoro(T2DApp.shotName); return
    case "arcadia", "arcadia-land", "arcadia-held", "arcadia-held-rim", "arcadia-sheet", "arcadia-fan": shotArc(T2DApp.shotName); return
    case "tria", "tria-lux", "tria-fall", "tria-held", "tria-sheet", "tria-fan": shotTria(T2DApp.shotName); return
    case "inferno", "inferno-held", "inferno-sheet", "inferno-fx", "inferno-storm", "inferno-fan": shotInferno(T2DApp.shotName); return
    case "natura", "natura-play", "natura-fx", "natura-res", "natura-skiff", "natura-ducks-away", "natura-sheet", "natura-menu": shotNatura(T2DApp.shotName); return
    case "portus", "portus-empty", "portus-play", "portus-echo", "portus-star", "portus-bloodmoon", "portus-sheet": shotPortus(T2DApp.shotName); return
    case "cymatica", "cym-empty", "cym-play", "cym-pinch", "cym-steprec", "cym-chance", "cym-drift", "cym-luna": shotCymatica(T2DApp.shotName); return
    case "tenebrae", "ten-empty", "ten-sun", "ten-hole", "ten-hold", "ten-lfo", "ten-ring", "ten-zoom", "ten-scale": shotTenebrae(T2DApp.shotName); return
    default: break
    }
    host.go(FirmamentumView.slotN)                          // прежние сцены — в мире, как до карты
    if T2DApp.shotName == "undo" { shotUndo(); return }
    world.dice()
    // плашки: сцена веба (firmsheet = firmtop) — только кубик; fx и комета остаются теми, что дал кубик
    if ["sheet", "starsheet", "lfo"].contains(T2DApp.shotName) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
        switch T2DApp.shotName {
        case "sheet": host.shotSheet(world.fxSpec)
        default: openStarSheet(lfo: T2DApp.shotName == "lfo")
        }
      }
      return
    }
    let core = AppCore(slot: FirmamentumView.slotN)
    core.action(4, 0, [0.6], touchTime: 0); core.action(4, 1, [0.6], touchTime: 0); core.action(4, 2, [1], touchTime: 0)
    core.action(7, 0, [], touchTime: 0)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
      core.action(4, 3, [0.8], touchTime: 0); core.action(4, 4, [1], touchTime: 0)
    }
    // верхняя строка: лад включён (подпись под заголовком); список ладов — зажатая кнопка лада; легенда — тап по заголовку
    let on = Scl(on: true, idx: 2, root: 3)
    switch T2DApp.shotName {
    case "topbar": host.shotState(scl: on)
    case "scales": host.shotState(scl: on, sclOpen: true)
    case "legend": host.shotState(scl: Scl.off, legendOpen: true)
    default: break
    }
  }

  // плашка первой звезды; lfo — панель на formant (u), 1 Гц, глубина 0.5, и RMS выхода за 2 с по 0.25 с в консоль (числа должны гулять)
  private func openStarSheet(lfo: Bool) {
    guard let id = world.mirror.stars.first?.id else { print("shot: no star"); fflush(stdout); return }
    host.shotSheet(world.starSheet(id), lfoKey: lfo ? "u" : nil)
    guard lfo else { return }
    host.shotLfo(rate: 1, depth: 0.5)
    _ = audio.takeRms()
    var out = [String]()
    for i in 1...8 {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25 * Double(i)) {
        out.append(String(format: "%.4f", audio.takeRms()))
        if i == 8 { print("shot-lfo rms/0.25s: " + out.joined(separator: " ")); fflush(stdout) }
      }
    }
  }

  // тап через Host, как палец
  private func touch(_ x: CGFloat, _ y: CGFloat, at t: Double) {
    let f = Finger(id: ObjectIdentifier(host), x: x, y: y, x0: x, y0: y, t0: t, moved: false, touchTime: t)
    host.down(f); host.up(f)
  }

  // карта: через 2 с кубик Firmamentum — из ядра, не входя в мир; снимок (5 с) — лучи у его карточки
  private func shotMap() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { _ = AppCore(slot: FirmamentumView.slotN).action(6, 0, [], touchTime: 0) }
  }

  // выход из Firmamentum: стрелка назад (iPhone 16: верхний inset 59), переход на середине
  private func shotNav() {
    host.go(FirmamentumView.slotN)
    world.dice()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { touch(26, 59 + 20, at: 2); host.shotFreeze(0.5) }
  }

  // «nondum»: тап по центру карточки Cymatica; поле — как у Host на iPhone 16 (inset 59 / 34)
  private func shotPeek() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      let b = UIScreen.main.bounds, c = Worlds.info(2)!
      let p = MapGeo.field(W: b.width, H: b.height, top: 59, safeBot: 34).rect(col: c.col, row: c.row)
      touch(p.midX, p.midY, at: 2); host.shotFreeze(0.5)
    }
  }

  // карта (iPhone 16: inset 59 / 34): тап по солнцу — concordia; mixer — дальше строка mixer, фейдер Arcadia влево на 60 pt, тап по mute её строки
  private func shotConcordia(mixer: Bool) {
    let b = UIScreen.main.bounds, q = DispatchQueue.main
    let sy = MapGeo.field(W: b.width, H: b.height, top: 59, safeBot: 34).sy
    q.asyncAfter(deadline: .now() + 1) { touch(b.width / 2, sy, at: 1) }
    guard mixer else { return }
    let box = Concordia.box(W: b.width, H: b.height, safeBot: 34, sunY: sy)
    q.asyncAfter(deadline: .now() + 1.5) { touch(b.width / 2, box.rows.first { $0.key == .mixer }!.y, at: 1.5) }
    q.asyncAfter(deadline: .now() + 2) {
      let g = Mixer.geo(W: b.width, H: b.height, top: 59, safeBot: 34), y = g.rows.first { $0.slot == 12 }!.y
      let x0 = g.tx0 + (g.tx1 - g.tx0) * CGFloat(Mix.faderDef)
      var f = Finger(id: ObjectIdentifier(host), x: x0, y: y, x0: x0, y0: y, t0: 2, moved: false, touchTime: 2)
      host.down(f)
      for i in 1...6 { f.x = x0 - 10 * CGFloat(i); f.moved = true; host.move(f) }
      host.up(f)
      touch(g.mx, y, at: 2.2)
    }
  }

  // Oceanus: два оставленных города; oceanus — ещё и временный под пальцем (веб oceanus-held), -sheet — плашка города,
  // -luna — плашка Луны (качание 0.8 на pitch), -fan — веер FX с панелью LFO на tide (полоса classic); сиды фиксированы (init: 7, пена: 8)
  private func shotOcean(_ name: String) {
    host.go(OceanusView.slotN)
    let core = AppCore(slot: OceanusView.slotN), q = DispatchQueue.main
    core.action(0, 0, [1.2, 0.5, 1, 0, 1], touchTime: 0); core.action(0, 0, [4.0, 0.6, 1, 1, 2], touchTime: 0)
    switch name {
    case "oceanus":
      q.asyncAfter(deadline: .now() + 1.5) {
        let p = ocean.geo.at(0.3, 0.8 * ocean.geo.Rd)
        host.down(Finger(id: ObjectIdentifier(host), x: p.x, y: p.y, x0: p.x, y0: p.y, t0: 1.5, moved: false, touchTime: 1.5))
      }
    case "oceanus-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(ocean.citySpec(1)) }
    case "oceanus-luna":
      core.action(5, 2, [0.8], touchTime: 0); core.action(5, 3, [1], touchTime: 0); core.action(4, 3, [0.55], touchTime: 0)
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(ocean.lunaSpec()) }
    default:
      core.action(4, 3, [0.55], touchTime: 0)
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(ocean.fxSpec, lfoKey: "tide"); host.shotLfo(rate: 1, depth: 0.5) }
    }
  }

  // Monochordum: monochord — кобылка I на 1/2, III поёт сама (sus), щипок II; -sheet — плашка струны II, -earth-sheet — плашка Земли,
  // -wind — плашка ветра (0.6) с LFO на wind (полоса random), -fan — веер FX с LFO на decay (полоса classic); сид init 7
  private func shotMono(_ name: String) {
    host.go(MonochordView.slotN)
    let core = AppCore(slot: MonochordView.slotN), q = DispatchQueue.main
    switch name {
    case "monochord":
      core.action(4, 0, [0.5], touchTime: 0); core.action(3, 2, [1], touchTime: 0)
      q.asyncAfter(deadline: .now() + 1) { core.action(0, 1, [0.3, 0.9], touchTime: 0) }
    case "monochord-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(mono.stringSpec(1)) }
    case "monochord-earth-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(mono.earthSpec()) }
    case "monochord-wind":
      core.action(6, 0, [0.6], touchTime: 0)
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(mono.windSpec(), lfoKey: "wind"); host.shotLfo(rate: 1, depth: 0.5) }
    default:
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(mono.fxSpec, lfoKey: "decay"); host.shotLfo(rate: 1, depth: 0.5) }
    }
  }

  // Horologium: horologium — кольцо II включено, ход RUN [1, 0], кадр через 1.5 с; -ring-sheet — плашка кольца IV, -hub-sheet — плашка ступицы,
  // -fan — веер FX с LFO на materia (полоса random), -spin — бросок через верх RUN [1, 7.5] за 1.2 с до кадра; сид init 7
  private func shotHoro(_ name: String) {
    host.go(HorologiumView.slotN)
    let core = AppCore(slot: HorologiumView.slotN), q = DispatchQueue.main
    switch name {
    case "horologium-ring-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(horo.ringSpec(3)) }
    case "horologium-hub-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(horo.hubSpec()) }
    case "horologium-fan":
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(horo.fx!, lfoKey: "materia"); host.shotLfo(rate: 1, depth: 0.5) }
    case "horologium-spin":   // ядро успокаивает u к uT (τ 6 с): снимок через 5 с поймал бы уже 3.2 — пускаем за 1.2 с до кадра, как веб-сцена
      q.asyncAfter(deadline: .now() + 3.8) { core.action(HorologiumView.Act.run, 0, [1, 7.5], touchTime: 0) }
    default:
      core.action(HorologiumView.Act.ring, 0, [0, 1], touchTime: 0); core.action(HorologiumView.Act.run, 0, [1, 0], touchTime: 0)
    }
  }

  // Arcadia (сид init 7, кадр через 5 с — страна в ядре растёт по кускам): arcadia — LAND 4242 и четыре странника (still / circuit / river / summit;
  // пара — веб arcadia-fixed), -land — пустая SEED0, -held — один странник (mode 1), подпись ноты и orbit; -held-rim — то же, подпись края,
  // -sheet — плашка viator, -fan — веер FX с LFO на wind (полоса random)
  private func shotArc(_ name: String) {
    host.go(ArcadiaView.slotN)
    let core = AppCore(slot: ArcadiaView.slotN), q = DispatchQueue.main, A = ArcadiaView.Act.self
    func add(_ s: Int, _ u: Double, _ v: Double, oct: Double = 0, r: Double = 0.16, fig: Double = 0, mode: Double = 2, sp: Double = 0.22) {
      core.action(A.add, s, [u, v, oct, r, fig, mode, sp, 0.8], touchTime: 0)
    }
    switch name {
    case "arcadia-land": break
    case "arcadia-held", "arcadia-held-rim":
      core.action(A.land, 0, [4242], touchTime: 0); add(0, 0.1, -0.2, mode: 1)
      q.asyncAfter(deadline: .now() + 3) { arc.holdShot(0, rim: name == "arcadia-held-rim") }
    case "arcadia-sheet", "arcadia-fan":
      core.action(A.land, 0, [4242], touchTime: 0); add(0, 0.1, -0.2, mode: 1)
      q.asyncAfter(deadline: .now() + 1.5) {
        if name == "arcadia-sheet" { host.shotSheet(arc.viatorSpec(0)) }
        else { host.shotSheet(arc.fx!, lfoKey: "wind"); host.shotLfo(rate: 1, depth: 0.5) }
      }
    default:
      core.action(A.land, 0, [4242], touchTime: 0)
      add(0, -0.5, -0.55, mode: 0); add(1, 0.45, -0.2, r: 0.22, fig: 1, mode: 1); add(2, 0.1, 0.45, fig: 2, mode: 3); add(3, -0.4, 0.25, oct: -1, mode: 4, sp: 0.4)
    }
  }

  // Tria (покой — три тела на окружности): tria — как есть, -lux — Fiat lux сразу, -fall — отвес сразу (всё падает), -held — подпись тела 1 через 3 с,
  // -sheet — плашка тела 1, -fan — веер FX с LFO на gravitas (полоса random); действие — раньше кадра shot.sh (+5 с)
  private func shotTria(_ name: String) {
    host.go(TriaView.slotN)
    let q = DispatchQueue.main
    switch name {
    case "tria-lux": tria.lux()
    case "tria-fall": tria.plumb()
    case "tria-held": q.asyncAfter(deadline: .now() + 3) { tria.holdShot(1) }
    case "tria-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(tria.bodySpec(1)) }
    case "tria-fan":
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(tria.fx!, lfoKey: "gravitas"); host.shotLfo(rate: 1, depth: 0.5) }
    default: break
    }
  }

  // Inferno: inferno — круг VI закреплён грешником; -held — круг III тлеет (подпись) через 3 с; -sheet — плашка круга VI; -fx — веер выкручен (дым, лёд, буря, огонь)
  // сразу; -storm — грешник на круге II (порывы бури); -fan — веер с LFO на fire; действие — раньше кадра shot.sh (+5 с)
  private func shotInferno(_ name: String) {
    host.go(InfernoView.slotN)
    let q = DispatchQueue.main
    func act(_ kind: Int, _ i: Int, _ v: Double) { inf.core.action(kind, i, [v], touchTime: 0) }
    switch name {
    case "inferno-held": q.asyncAfter(deadline: .now() + 3) { inf.holdShot(2, pos: 0.8) }
    case "inferno-sheet":
      act(Inf.Act.pin, 6, 0.4)
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(inf.circleSpec(6)) }
    case "inferno-fx":
      act(Inf.Act.pin, 6, 0.4); act(Inf.Act.pin, 2, 0.3); act(Inf.Act.fx, 3, 0.7); act(Inf.Act.fx, 2, 0.7)
    case "inferno-storm": act(Inf.Act.pin, 1, 0.5)
    case "inferno-fan":
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(inf.fx!, lfoKey: "fire"); host.shotLfo(rate: 1, depth: 0.5) }
    default: act(Inf.Act.pin, 6, 0.4)
    }
  }

  // Natura: natura — демо; -play — играет; -fx — веер выкручен (туман, облака, дождь, птицы, туча); -res — резонанс 0.95 (горы выше);
  // -skiff — играет, через 1.5 с челнок на воде у кувшинки 10; -ducks-away — через 3.9 с испуг (утки в воздухе); -sheet — плашка кувшинки 4;
  // -menu — через 1.5 с меню цветков над челноком; действие — раньше кадра shot.sh (+5 с)
  private func shotNatura(_ name: String) {
    host.go(NaturaView.slotN)
    let q = DispatchQueue.main
    typealias A = Nat.Act
    switch name {
    case "natura-play": nat.send(A.play, 0, [1])
    case "natura-fx": for k in 0...4 { nat.send(A.setfx, k, [1]) }
    case "natura-res": nat.send(A.setfx, 5, [0.95])
    case "natura-skiff":
      nat.send(A.play, 0, [1])
      q.asyncAfter(deadline: .now() + 1.5) { nat.skiffShot(9, note: 12) }
    case "natura-ducks-away": q.asyncAfter(deadline: .now() + 3.9) { nat.send(A.scare, 0) }
    case "natura-sheet": q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(nat.lilySpec(3)) }
    case "natura-menu": q.asyncAfter(deadline: .now() + 1.5) { nat.menuShot() }
    default: break
    }
  }

  // Portus: portus — кубик; -empty — пусто; -play — места 2 и 10 (ноты 0 и 7), веха 6, играет; -echo — как play, луна открыта (cut 0.8),
  // буй к морю (как в sc_portus); -star — как echo, через 4.3 с тап по небу: звезда в полёте на кадре (+5 с);
  // -bloodmoon — туман 0.8, через 1 с плашка луны с LFO на cutoff; -sheet — как play, октава маяка −1, через 1.5 с плашка маяка;
  // действие — раньше кадра shot.sh (+5 с)
  private func shotPortus(_ name: String) {
    host.go(PortusView.slotN)
    let q = DispatchQueue.main
    typealias A = Por.Act
    func lane() {
      por.send(A.place, 2, [0, 500]); por.send(A.place, 10, [7, 500]); por.send(A.place, 6, [7, 500]); por.send(A.play, 0, [1])
    }
    // луна открыта, буй к морю — общая подготовка для echo и star
    func echo() {
      lane(); por.send(A.luna, 0, [0.8])
      let b = por.geo.slotPt(14, 2), u = por.geo.unP(b.x, b.y)
      por.send(A.buoy, 0, [u.u, u.d])
    }
    switch name {
    case "portus-play": lane()
    case "portus-echo": echo()
    case "portus-star":
      echo()
      q.asyncAfter(deadline: .now() + 4.3) { por.send(A.kill, 0); por.state.kill(x: 200, y: 120, now: por.now) }
    case "portus-bloodmoon":
      lane(); por.send(A.fog, 0, [0.8])
      q.asyncAfter(deadline: .now() + 1) { host.shotSheet(por.lunaSpec, lfoKey: "cut"); host.shotLfo(rate: 1, depth: 0.5) }
    case "portus-sheet":
      lane(); por.send(A.pharos, 1, [-1])   // oct — индекс 1 в PHAROS ядра, значение — октава как есть
      q.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(por.pharosSpec) }
    case "portus": por.dice()
    default: break
    }
  }

  // Cymatica: cymatica — кубик (для карты); -empty — покой; -play — ритм 8, мелодия 3, 120 BPM, кубик (как astrolabe веба);
  // -pinch — без лада, подпись высоты, удар в клетку (кольцо 1, сектор 1); -steprec — пошаговый ввод: три удара, пропуск, удар;
  // -chance — удар 0 с шансом 0.5 и подписью; -drift — кубик, дрейф луны, играет; -luna — как drift, плашка луны (как sc_* веба)
  private func shotCymatica(_ name: String) {
    host.go(CymaticaView.slotN)
    typealias A = Cym.Act
    func plate(_ x: Double, _ y: Double) -> [Double] { [x / cym.geo.r, y / cym.geo.r] }
    // дедлайны и деления на радиус плиты — после первого тика: до него now = 0, а geo не собран под экран
    func later(_ f: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: f) }
    switch name {
    case "cym-play":
      cym.send(A.len, 0, [8]); cym.send(A.len, 1, [3]); cym.send(A.bpm, 0, [120]); cym.dice()
    case "cym-pinch":
      later {
        cym.labelUntil = cym.now + 60
        let c = cymCellCenter(ring: 1, sector: 1, n: cym.scl.degPerOct)   // координаты плиты
        cym.send(A.strikeAt, 0, [c.x, c.y])
      }
    case "cym-steprec":
      later {
        cym.send(A.clear); cym.send(A.stepRec, 0, [1, 0, 0])
        cym.send(A.strikeAt, 0, plate(-40, 0)); cym.send(A.strikeAt, 0, plate(30, -30))
        cym.send(A.skip); cym.send(A.strikeAt, 0, plate(0, 40))
      }
    case "cym-chance":
      later { cym.send(A.beat, 0); cym.send(A.chanceAt, 0, [0.5]); cym.chanceEdit = (0, cym.now + 60) }
    case "cym-drift": cym.dice(); cym.send(A.driftToggle); cym.send(A.play, 0, [1])
    case "cym-luna":
      cym.dice(); cym.send(A.driftToggle); cym.send(A.play, 0, [1])
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { host.shotSheet(cym.driftSpec) }
    case "cymatica": cym.dice()
    default: break
    }
  }

  // Tenebrae: tenebrae — три закреплённые (пара веба planets); -empty — пустое поле, призрак первого касания;
  // -sun — палец ведёт планету к солнцу, не отпущен; -hole — закреплённую тянут в дыру; -hold — удержание, плашка, amp 0;
  // -lfo — плашка, cut +0.25, тап по «~»; -ring — две закреплённые, связь, закреплённое кольцо; -zoom — зум 0.5 с подписями;
  // -scale — лад включён. Пальцы и места — как у веба (экран 390x844); всё после первого тика (0.5 с): до него нет геометрии
  private func shotTenebrae(_ name: String) {
    host.go(TenebraeView.slotN)
    if name != "ten-empty" { ten.touchedOnce = true }
    let q = DispatchQueue.main, fid = NSObject()
    func later(_ t: Double, _ f: @escaping () -> Void) { q.asyncAfter(deadline: .now() + t, execute: f) }
    func finger(_ x: Double, _ y: Double, _ x0: Double, _ y0: Double) -> Finger {
      Finger(id: ObjectIdentifier(fid), x: CGFloat(x), y: CGFloat(y), x0: CGFloat(x0), y0: CGFloat(y0), t0: ten.now, moved: false, touchTime: ten.now)
    }
    // закреплённая планета: как кубик (SPAWN, PIN, отпустить); nil — мест нет
    @discardableResult func pin(_ x: Double, _ y: Double) -> Int? {
      guard let s = ten.spawnAt(x, y) else { return nil }
      ten.send(Act.pin, s.i); ten.send(Act.letGo, s.i, [0])
      return s.i
    }
    // палец идёт по прямой за n шагов с шагом 0.05 с, начиная с t
    func drag(from a: (x: Double, y: Double), to b: (x: Double, y: Double), steps n: Int, at t: Double) {
      for k in 1...n {
        later(t + 0.05 * Double(k)) {
          let u = Double(k) / Double(n)
          var f = finger(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.x, a.y)
          f.moved = true
          ten.move(f)
        }
      }
    }
    func three() { pin(110, 640); pin(250, 560); pin(120, 380) }
    switch name {
    case "tenebrae": later(0.5) { three() }
    case "ten-sun":
      later(0.5) { ten.down(finger(160, 560, 160, 560)) }
      drag(from: (160, 560), to: (30, 804), steps: 14, at: 0.6)
    case "ten-hole":
      later(0.5) { pin(200, 420) }
      later(1.0) { ten.down(finger(200, 420, 200, 420)) }
      later(1.05) {
        let h = ten.geo.holeAt                              // дыра — после первого тика
        drag(from: (200, 420), to: (h.x + 30, h.y + 10), steps: 16, at: 0)
      }
    case "ten-hold":
      later(0.5) { pin(200, 300) }
      later(1.0) { ten.down(finger(200, 300, 200, 300)) }
      later(1.7) { ten.up(finger(200, 300, 200, 300)) }          // как веб: плашка открыта, палец отпущен (тоньше контур)
      later(1.8) { if let i = ten.sheetVoice { ten.send(Act.set, i, [Double(Row.amp.rawValue), 0]) } }
    case "ten-lfo":
      later(0.5) {
        guard let i = pin(200, 300) else { return }
        later(0.3) {
          ten.openPlanetSheet(i)
          ten.send(Act.set, i, [Double(Row.cut.rawValue), min(1, ten.voice(i).cut + 0.25)])
          later(0.3) {
            let s = ten.sheetGeo
            let f = finger(s.lfoX, s.rowY(0) + 10, s.lfoX, s.rowY(0) + 10)
            _ = ten.sheetDown(f); ten.sheetUp(f)
          }
        }
      }
    case "ten-ring":
      later(0.5) {
        guard let a = pin(120, 560), let b = pin(260, 420) else { return }
        later(0.4) {
          ten.send(Act.link, a, [Double(b)])
          later(0.4) {
            let m = ten.linkMid(dst: a, src: b)
            let f = finger(m.x, m.y, m.x, m.y)
            ten.down(f); ten.up(f)
          }
        }
      }
    case "ten-zoom":
      later(0.5) { three(); ten.zoomT = 0.5; ten.zoomShow = ten.now + 60 }
    case "ten-scale":
      later(0.5) { pin(150, 560) }
      host.shotState(scl: Scl(on: true, idx: 2, root: 3))
    default: break                                          // ten-empty: пустое поле
    }
  }

  // -shot audio: в Firmamentum тап по кнопке громкости (W − 238, top + 20)
  private func shotAudio() {
    host.go(FirmamentumView.slotN)
    world.dice()
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { touch(UIScreen.main.bounds.width - 238, 59 + 20, at: 1) }
  }

  // -shot undo: тап по небу → звезда → кнопка undo → звезды нет; касания идут через Host, число звёзд — в консоль (stdout)
  private func shotUndo() {
    func report(_ what: String) { print("shot-undo \(what): stars=\(world.mirror.stars.count)"); fflush(stdout) }
    let q = DispatchQueue.main
    q.asyncAfter(deadline: .now() + 1.0) { touch(195, 450, at: 1.0) }
    q.asyncAfter(deadline: .now() + 2.5) { report("after tap"); touch(390 - 66, 79, at: 2.5) }
    q.asyncAfter(deadline: .now() + 4.0) { report("after undo") }
  }
}
