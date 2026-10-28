import UIKit
import SwiftUI

// сцена: один UIView на весь экран. CADisplayLink → кадр (зеркало и услышанное → world.tick → setNeedsDisplay);
// draw(_:) → тема + world.draw; касания → пальцы мира. Угол экрана и карта миров — задача 9.
final class Stage: UIView {
  let world: FirmamentumView
  private var link: CADisplayLink?
  private var last = 0.0
  private var fingers: [ObjectIdentifier: Finger] = [:]
  private var geoSize = CGSize.zero, geoTop = CGFloat(-1), geoBot = CGFloat(-1)

  init(world: FirmamentumView) {
    self.world = world
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
    world.geo = Geo(W: bounds.width, H: bounds.height, topY: top, safeBot: bot)
  }
  override func layoutSubviews() { super.layoutSubviews(); updateGeo() }
  override func safeAreaInsetsDidChange() { super.safeAreaInsetsDidChange(); updateGeo() }

  @objc private func frame(_ l: CADisplayLink) {
    let now = CACurrentMediaTime(), dt = now - last
    last = now
    updateGeo()
    world.tick(now: now, dt: dt)
    setNeedsDisplay()
  }

  private var drawer: Draw?
  override func draw(_ rect: CGRect) {
    guard let g = UIGraphicsGetCurrentContext() else { return }
    let d: Draw
    if let x = drawer { d = x; d.g = g; d.W = bounds.width; d.H = bounds.height }
    else { d = Draw(g: g, W: bounds.width, H: bounds.height); drawer = d }   // один Draw — кеш шрифтов живёт между кадрами
    d.setTheme(world.theme)
    world.draw(d, now: CACurrentMediaTime())
  }

  // ---------- касания ----------
  private func finger(_ t: UITouch, new: Bool) -> Finger {
    let p = t.location(in: self), id = ObjectIdentifier(t)
    var f = fingers[id] ?? Finger(id: id, x: p.x, y: p.y, x0: p.x, y0: p.y, t0: t.timestamp, moved: false, touchTime: t.timestamp)
    f.x = p.x; f.y = p.y; f.touchTime = t.timestamp
    if hypot(f.x - f.x0, f.y - f.y0) > Touch.tapMove { f.moved = true }
    fingers[id] = f
    return f
  }
  override func touchesBegan(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { world.down(finger(t, new: true)) } }
  override func touchesMoved(_ ts: Set<UITouch>, with e: UIEvent?) { for t in ts { world.move(finger(t, new: false)) } }
  override func touchesEnded(_ ts: Set<UITouch>, with e: UIEvent?) { release(ts) }
  override func touchesCancelled(_ ts: Set<UITouch>, with e: UIEvent?) { release(ts) }
  private func release(_ ts: Set<UITouch>) {
    for t in ts { let f = finger(t, new: false); fingers[f.id] = nil; world.up(f) }
  }
}

struct StageView: UIViewRepresentable {
  func makeUIView(context: Context) -> Stage {
    Stage(world: FirmamentumView(core: AppCore(slot: FirmamentumView.slotN), geo: Geo(W: 390, H: 844, topY: 59, safeBot: 34)))
  }
  func updateUIView(_ v: Stage, context: Context) {}
}
