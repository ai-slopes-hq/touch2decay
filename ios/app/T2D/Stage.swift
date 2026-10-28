import UIKit
import SwiftUI
import T2DCore

// сцена: один UIView на весь экран. CADisplayLink → кадр (зеркало и услышанное → world.tick → setNeedsDisplay);
// draw(_:) → тема + world.draw (+ панель замеров); касания → пальцы мира. Правый нижний угол 44×44 — не мира:
// долгое нажатие (HOLD_MS) показывает / прячет панель замеров. Карта миров — позже.
final class Stage: UIView {
  let world: FirmamentumView
  private var link: CADisplayLink?
  private var last = 0.0
  let meter = Meter()
  private let audio: Audio?
  private var panelLine = ""
  private var statsAt = 0.0, frameStart = 0.0
  private struct Corner { var t0: Double; var x0, y0: CGFloat; var fired = false }
  private var corner: [ObjectIdentifier: Corner] = [:]
  private var dropped: Set<ObjectIdentifier> = []          // палец из угла, ушедший дальше holdMove: съеден, миру не идёт до подъёма / отмены
  private var fingers: [ObjectIdentifier: Finger] = [:]
  private var geoSize = CGSize.zero, geoTop = CGFloat(-1), geoBot = CGFloat(-1)

  init(world: FirmamentumView, audio: Audio?) {
    self.world = world; self.audio = audio
    super.init(frame: .zero)
    contentScaleFactor = Draw.scale                        // плотность рисования не больше 2×
    isOpaque = true; isMultipleTouchEnabled = true
    backgroundColor = world.theme.bg
  }
  required init?(coder: NSCoder) { fatalError() }

  override func didMoveToWindow() {
    link?.invalidate(); link = nil
    guard window != nil else { return }
    let l = CADisplayLink(target: self, selector: #selector(frame(_:)))
    l.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 60, preferred: 60)
    l.add(to: .main, forMode: .common)
    link = l; last = CACurrentMediaTime()
  }

  // геометрия мира: topY = верхний inset + 44 (строка кнопок), safeBot = нижний inset
  private func updateGeo() {
    let top = safeAreaInsets.top + 44, bot = safeAreaInsets.bottom
    guard bounds.size != geoSize || top != geoTop || bot != geoBot, bounds.width > 0 else { return }
    geoSize = bounds.size; geoTop = top; geoBot = bot
    world.layout(W: bounds.width, H: bounds.height, topY: top, safeBot: bot)
  }
  override func layoutSubviews() { super.layoutSubviews(); updateGeo() }
  override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); updateGeo() }

  @objc private func frame(_ l: CADisplayLink) {
    let now = CACurrentMediaTime(), dt = now - last
    last = now; frameStart = now
    updateGeo()
    cornerTick(now: now)
    world.tick(now: now, dt: dt)
    if now - statsAt >= 1 { statsAt = now; second() }
    setNeedsDisplay()
  }

  // раз в секунду: окно ядра + окно кадров → строка в лог и на панель
  private func second() {
    var st = t2d_app_stats_t()
    t2d_app_stats(&st)
    panelLine = meter.line(stats: st, outLat: audio?.outputLatency ?? 0, frames: audio?.frames ?? Int(st.frames),
                           sr: audio?.sampleRate ?? 0, stars: world.mirror.stars.count)
    Log.shared.add("meter", panelLine)
  }

  // ---------- угол: долгое нажатие переключает панель ----------
  private func inCorner(_ f: Finger) -> Bool { f.x0 > world.geo.W - Touch.cornerPt && f.y0 > world.geo.H - Touch.cornerPt }
  private func fire(_ id: ObjectIdentifier) {
    guard var c = corner[id], !c.fired else { return }
    c.fired = true; corner[id] = c; meter.visible.toggle(); setNeedsDisplay()
  }
  private func cornerTick(now: Double) {
    for (id, c) in corner where (now - c.t0) * 1000 >= Touch.holdMs { fire(id) }
  }

  private var drawer: Draw?
  override func draw(_ rect: CGRect) {
    guard let g = UIGraphicsGetCurrentContext() else { return }
    let d: Draw
    if let x = drawer { d = x; d.g = g; d.W = bounds.width; d.H = bounds.height }
    else { d = Draw(g: g, W: bounds.width, H: bounds.height); drawer = d }   // один Draw — кеш шрифтов живёт между кадрами
    d.setTheme(world.theme)
    world.draw(d, now: CACurrentMediaTime())
    if meter.visible && !panelLine.isEmpty {
      d.reading { d.text(panelLine, bounds.width / 2, bounds.height - max(geoBot, 0) - 14, 11, 0.6, align: .center) }
    }
    if frameStart > 0 { meter.frame(start: frameStart, end: CACurrentMediaTime(), missed: 0) }
  }

  // ---------- касания ----------
  private func finger(_ t: UITouch) -> Finger {
    let p = t.location(in: self), id = ObjectIdentifier(t)
    var f = fingers[id] ?? Finger(id: id, x: p.x, y: p.y, x0: p.x, y0: p.y, t0: t.timestamp, moved: false, touchTime: t.timestamp)
    f.x = p.x; f.y = p.y; f.touchTime = t.timestamp
    if hypot(f.x - f.x0, f.y - f.y0) > Touch.tapMove { f.moved = true }
    fingers[id] = f
    return f
  }
  override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { touchDown(finger(t)) } }
  override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { touchMove(finger(t)) } }
  override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) { release(ts) }
  override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) {
    for t in ts { let f = finger(t); fingers[f.id] = nil; touchCancel(f) }
  }
  private func release(_ ts: Set<UITouch>) {
    for t in ts { let f = finger(t); fingers[f.id] = nil; touchUp(f) }
  }

  // маршрут пальца: угол — Stage, остальное — миру (внутренние — для тестов)
  func touchDown(_ f: Finger) {
    if inCorner(f) { corner[f.id] = Corner(t0: f.t0, x0: f.x0, y0: f.y0); return }
    world.down(f)
  }
  func touchMove(_ f: Finger) {
    if let c = corner[f.id] {
      if hypot(f.x - c.x0, f.y - c.y0) > Touch.holdMove { corner[f.id] = nil; dropped.insert(f.id) }   // сдвинулся — не удержание
      return
    }
    if dropped.contains(f.id) { return }
    world.move(f)
  }
  func touchUp(_ f: Finger) {
    if corner[f.id] != nil {
      if (f.touchTime - f.t0) * 1000 >= Touch.holdMs { fire(f.id) }
      corner[f.id] = nil
      return
    }
    if dropped.remove(f.id) != nil { return }
    world.up(f)
  }
  // система отняла касание: ни тапа, ни удержания — состояние пальца просто бросаем
  func touchCancel(_ f: Finger) {
    let ours = corner.removeValue(forKey: f.id) != nil, eaten = dropped.remove(f.id) != nil
    if !ours && !eaten { world.cancel(f) }
  }
}

struct StageView: UIViewRepresentable {
  let audio: Audio
  func makeUIView(context: Context) -> Stage {
    Stage(world: FirmamentumView(core: AppCore(slot: FirmamentumView.slotN), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34)), audio: audio)
  }
  func updateUIView(_ v: Stage, context: Context) {}
}
