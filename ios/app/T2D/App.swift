import SwiftUI

// -shot <сцена>: снимок сцены для shot.sh. Сцены:
//   firmamentum (по умолчанию) | topbar | scales | legend | sheet | starsheet | lfo | undo — сначала host.go(10): вход в Firmamentum без перехода;
//   map — старт на карте, через 2 с кубик в Firmamentum (через ядро, без входа): к снимку (5 с) у его карточки лучи;
//   nav — go(10), кубик, через 2 с тап по стрелке назад (выход), переход заморожен на k = 0.5;
//   peek — тап по карточке Cymatica (лицо без вида), peek заморожен на середине («nondum»).
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
  @State private var host: Host

  // миры с нативным видом — по реестру; шрифты в Info.plist (UIAppFonts) подхвачены до первого кадра, раньше первой карты
  private static func makeView(_ slot: Int) -> World? {
    switch slot {
    case FirmamentumView.slotN: return FirmamentumView(core: AppCore(slot: slot), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34))
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
    _audio = State(initialValue: a); _world = State(initialValue: views.compactMap { $0 as? FirmamentumView }[0]); _host = State(initialValue: h)
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

  // -shot undo: тап по небу → звезда → кнопка undo → звезды нет; касания идут через Host, число звёзд — в консоль (stdout)
  private func shotUndo() {
    func report(_ what: String) { print("shot-undo \(what): stars=\(world.mirror.stars.count)"); fflush(stdout) }
    let q = DispatchQueue.main
    q.asyncAfter(deadline: .now() + 1.0) { touch(195, 450, at: 1.0) }
    q.asyncAfter(deadline: .now() + 2.5) { report("after tap"); touch(390 - 66, 79, at: 2.5) }
    q.asyncAfter(deadline: .now() + 4.0) { report("after undo") }
  }
}
