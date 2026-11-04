import XCTest
@testable import T2D

// общее для тестов рисования Tenebrae (задачи 2-5): оснастка вида, снимок, поиск света

private final class RigCore: Core {
  func action(_ kind: Int, _ i: Int, _ a: [Double], touchTime: Double) -> Bool { true }
}

// вид с зеркалом и очередью heard; зеркало 387: [0] = 6, fx по умолчанию, у всех LFO нет (depth −1) — как TenebraeTests
final class TenRig {
  private let core = RigCore()
  var mbuf: [Double] = []
  var heardQ: [[Double]] = []
  var level = 0.0
  lazy var view = TenebraeView(core: core, readMirror: { [unowned self] b in
    let n = min(self.mbuf.count, b.count); b.replaceSubrange(0..<n, with: self.mbuf[0..<n]); return n
  }, readHeard: { [unowned self] b in
    guard !self.heardQ.isEmpty else { return 0 }
    let q = self.heardQ.removeFirst(); b.replaceSubrange(0..<q.count, with: q); return q.count
  }, readLevel: { [unowned self] in self.level }, rng: { 0.5 })

  init() {
    mbuf = base()
    view.layout(W: 390, H: 844, topY: 103, safeBot: 34)
  }

  private func base(_ edit: (inout [Double]) -> Void = { _ in }) -> [Double] {
    var b = [Double](repeating: 0, count: Ten.mirrorN)
    b[0] = 6; b[3] = 0.3; b[4] = 3.5; b[5] = 0.3; b[6] = 0; b[7] = 0.2
    for i in 0..<6 { for k in 0..<8 { b[Ten.head + Ten.voiceN * i + 38 + 3 * k + 2] = -1 } }
    edit(&b)
    return b
  }
  func mirror(_ edit: (inout [Double]) -> Void) { mbuf = base(edit) }
  func voice(_ b: inout [Double], _ i: Int, active: Bool = true, pinned: Bool = false, held: Bool = false,
             x: Double = 0.4, y: Double = 0.5, beat: Double = 0.35, env: Double = 1, envT: Double = 1, holeT: Double = 0) {
    let o = Ten.head + Ten.voiceN * i
    b[o] = active ? 1 : 0; b[o + 1] = active ? 1 : 0; b[o + 2] = pinned ? 1 : 0; b[o + 3] = held ? 1 : 0
    b[o + 4] = x; b[o + 5] = y; b[o + 6] = beat; b[o + 13] = holeT; b[o + 15] = env; b[o + 16] = envT
  }
  // контур голоса i: длина 1161, живой, синус в 3 периода с амплитудой peak
  func scope(_ b: inout [Double], _ i: Int, peak: Double) {
    if b.count < Ten.mirrorFull { b += [Double](repeating: 0, count: Ten.mirrorFull - b.count) }
    let o = Ten.mirrorN + Ten.scopeN * i
    b[o] = 1
    for j in 0..<Ten.scopePts { b[o + 1 + j] = peak * sin(Double(j) / Double(Ten.scopePts) * 6 * .pi) }
  }
  func tick(_ t: Double) { view.tick(now: t, dt: 0.016) }
}

func tenRegisterFonts() {
  let urls = Bundle(for: TenRig.self).urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? []
  for u in urls { CTFontManagerRegisterFontsForURL(u as CFURL, .process, nil) }
}

// кадр на чёрном фоне 390×844 (scale — плотность)
func tenShot(_ v: TenebraeView, scale: CGFloat = 1, _ draw: (Draw) -> Void) -> CGImage {
  let size = CGSize(width: 390, height: 844)
  let f = UIGraphicsImageRendererFormat(); f.scale = scale; f.opaque = true
  return UIGraphicsImageRenderer(size: size, format: f).image { r in
    UIColor.black.setFill(); r.cgContext.fill(CGRect(origin: .zero, size: size))
    let d = Draw(g: r.cgContext, W: size.width, H: size.height)
    d.setTheme(v.theme)
    draw(d)
  }.cgImage!
}

// число пикселей ярче over по любому каналу в прямоугольнике r (в пикселях образа)
func tenLit(_ img: CGImage, _ r: CGRect, over: UInt8 = 24) -> Int {
  let w = img.width, h = img.height
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  let x0 = max(0, Int(r.minX)), x1 = min(w, Int(r.maxX.rounded(.up))), y0 = max(0, Int(r.minY)), y1 = min(h, Int(r.maxY.rounded(.up)))
  var n = 0
  if x0 >= x1 || y0 >= y1 { return 0 }
  for y in y0..<y1 { for x in x0..<x1 {
    let o = (y * w + x) * 4
    if buf[o] > over || buf[o + 1] > over || buf[o + 2] > over { n += 1 }
  } }
  return n
}
