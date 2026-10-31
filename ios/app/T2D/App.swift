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
//   arcadia | arcadia-land | arcadia-held | arcadia-held-rim | arcadia-sheet | arcadia-fan — go(12), см. shotArc.
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
  @State private var host: Host

  // миры с нативным видом — по реестру; шрифты в Info.plist (UIAppFonts) подхвачены до первого кадра, раньше первой карты
  private static func makeView(_ slot: Int) -> World? {
    switch slot {
    case FirmamentumView.slotN: return FirmamentumView(core: AppCore(slot: slot), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34))
    case OceanusView.slotN:
      return OceanusView(core: AppCore(slot: slot), geo: OceanGeo(W: 390, H: 844, topY: 59, safeBot: 34),
                         readMirror: OceanusView.appMirror)
    case MonochordView.slotN: return MonochordView(core: AppCore(slot: slot))
    case HorologiumView.slotN: return HorologiumView(core: AppCore(slot: slot))
    case ArcadiaView.slotN: return ArcadiaView(core: AppCore(slot: slot))
    default: return nil
    }
  }

  init() {
    let views = Worlds.all.filter(\.view).compactMap { T2DApp.makeView($0.slot) }
    let watch = views.reduce(UInt32(0)) { $0 | (1 << UInt32($1.slot)) }
    let a = Audio(log: .shared, seed: T2DApp.shot ? 7 : 1, watch: watch)
    a.probe = T2DApp.shot && T2DApp.shotName == "lfo"
    let h = Host(views: views, core: AppHostCore(), store: Store(dir: T2DApp.storeDir(), log: { Log.shared.add("store", $0) }))
    a.onInit = { h.reapply() }
    a.stable = h.audioPref.stable                           // до start(): буфер берётся при запуске
    h.onRestart = { a.restart() }; h.onStable = { a.stable = $0 }
    _audio = State(initialValue: a); _world = State(initialValue: views.compactMap { $0 as? FirmamentumView }[0]); _ocean = State(initialValue: views.compactMap { $0 as? OceanusView }[0]); _mono = State(initialValue: views.compactMap { $0 as? MonochordView }[0]); _horo = State(initialValue: views.compactMap { $0 as? HorologiumView }[0]); _arc = State(initialValue: views.compactMap { $0 as? ArcadiaView }[0]); _host = State(initialValue: h)
  }

  var body: some Scene {
    WindowGroup {
      StageView(host: host, audio: audio).ignoresSafeArea().background(Color.black)
        .onAppear { audio.start(); if T2DApp.shot { shotScene() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in host.background() }
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
