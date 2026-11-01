import UIKit
@testable import T2D

// общие помощники тестов Natura: холст 200×200 (масштаб 1) и счёт чернильных пикселей

let natInk: RGB = (38, 26, 16), natPap: RGB = (226, 211, 174)

// бумага на весь холст, рисует draw с кистью темы мира; картинка — для сравнения байт
func natCanvas(_ draw: (NatPen) -> Void) -> UIImage {
  let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
  return UIGraphicsImageRenderer(size: CGSize(width: 200, height: 200), format: f).image { r in
    let p = NatPen(g: r.cgContext, inkC: natInk, papC: natPap)
    p.fillPap(1); p.fillRect(0, 0, 200, 200)
    draw(p)
  }
}

func natBytes(_ i: UIImage) -> Data { i.cgImage!.dataProvider!.data! as Data }

// пиксели в rect (точки = пиксели), у которых хоть один канал темнее бумаги на 20+
func inkPixels(_ img: UIImage, in rect: CGRect) -> Int {
  guard let cg = img.cgImage, let data = cg.dataProvider?.data, let b = CFDataGetBytePtr(data) else { return 0 }
  let bpp = cg.bitsPerPixel / 8, bpr = cg.bytesPerRow
  let want = [Int(natPap.r), Int(natPap.g), Int(natPap.b)]
  var n = 0
  let x0 = max(0, Int(rect.minX)), x1 = min(cg.width, Int(rect.maxX)), y0 = max(0, Int(rect.minY)), y1 = min(cg.height, Int(rect.maxY))
  guard x0 < x1, y0 < y1 else { return 0 }
  // порядок каналов берём из bitmapInfo: RGBA (первый — R) или BGRA/ARGB
  let little = cg.bitmapInfo.contains(.byteOrder32Little)
  let first = cg.alphaInfo == .premultipliedFirst || cg.alphaInfo == .noneSkipFirst || cg.alphaInfo == .first
  for y in y0..<y1 { for x in x0..<x1 {
    let o = y * bpr + x * bpp
    let c: [Int]
    if little { c = [Int(b[o + 2]), Int(b[o + 1]), Int(b[o])] }
    else if first { c = [Int(b[o + 1]), Int(b[o + 2]), Int(b[o + 3])] }
    else { c = [Int(b[o]), Int(b[o + 1]), Int(b[o + 2])] }
    if (0..<3).contains(where: { want[$0] - c[$0] >= 20 }) { n += 1 }
  } }
  return n
}
