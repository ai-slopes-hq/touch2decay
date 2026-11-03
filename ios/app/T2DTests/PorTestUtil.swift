import UIKit
@testable import T2D

// пиксели в rect (пиксели образа), у которых хоть один канал светлее bg на 20+ (тёмная бумага Portus; inkPixels Natura считает темнее)
func litPixels(_ img: CGImage, in rect: CGRect, bg: RGB) -> Int {
  guard let data = img.dataProvider?.data, let b = CFDataGetBytePtr(data) else { return 0 }
  let bpp = img.bitsPerPixel / 8, bpr = img.bytesPerRow
  let want = [Int(bg.r), Int(bg.g), Int(bg.b)]
  let x0 = max(0, Int(rect.minX)), x1 = min(img.width, Int(rect.maxX)), y0 = max(0, Int(rect.minY)), y1 = min(img.height, Int(rect.maxY))
  guard x0 < x1, y0 < y1 else { return 0 }
  let little = img.bitmapInfo.contains(.byteOrder32Little)
  let first = img.alphaInfo == .premultipliedFirst || img.alphaInfo == .noneSkipFirst || img.alphaInfo == .first
  var n = 0
  for y in y0..<y1 { for x in x0..<x1 {
    let o = y * bpr + x * bpp
    let c: [Int]
    if little { c = [Int(b[o + 2]), Int(b[o + 1]), Int(b[o])] }
    else if first { c = [Int(b[o + 1]), Int(b[o + 2]), Int(b[o + 3])] }
    else { c = [Int(b[o]), Int(b[o + 1]), Int(b[o + 2])] }
    if (0..<3).contains(where: { c[$0] - want[$0] >= 20 }) { n += 1 }
  } }
  return n
}
