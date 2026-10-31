import UIKit

// палец: x, y — сейчас, x0, y0 — где лёг; t0 — когда лёг, touchTime — метка текущего события (UITouch.timestamp, сек)
struct Finger {
  var id: ObjectIdentifier
  var x, y, x0, y0: CGFloat
  var t0: Double
  var moved: Bool
  var touchTime: Double
}

// глиф жеста в легенде (как в host/legend.js)
enum Glyph: String { case tap, double, hold, drag, up, draw, `throw`, shake, two, pinch, twist }
struct LegendRow { let glyph: Glyph; let gesture: String; let does: String }

// мир: слот ядра, тема, шаг, рисование и касания (как интерфейс мира в host/)
// мир с асинхронной правкой сцены (кубик Arcadia): после неё просит хост снять ещё один шаг отмены
protocol UndoCommitting: AnyObject {
  var commitUndo: (() -> Void)? { get set }              // ставит хост: снять undo-снимок мира сейчас
}

protocol World: AnyObject {
  var slot: Int { get }
  var theme: Theme { get }
  var title: String { get }
  var sub: String { get }
  var legend: [LegendRow] { get }
  var fx: SheetSpec? { get }                             // веер мира; nil — кнопка FX приглушена
  var openSheet: ((SheetSpec) -> Void)? { get set }      // ставит хост: мир просит открыть плашку
  var objGone: ((Int) -> Void)? { get set }              // ставит хост: объект мира пропал (его LFO гасит хост)
  var rowLfoOff: ((Int) -> Void)? { get set }            // ставит хост: снять LFO строки мира (obj −1) по коду, база вернётся
  func layout(W: CGFloat, H: CGFloat, topY: CGFloat, safeBot: CGFloat)
  func cornerHit(_ x: CGFloat, _ y: CGFloat) -> Bool     // предмет, ведущий на карту
  func dice()
  func clear()
  func enter()                                           // хост вошёл в мир (goWorld, go): разбудить ядро мира
  func scale(pcs: [Int]?, root: Int)                     // лад сменился: ноты лада по модулю 12 от A, nil — выключен; root — тоника (0, когда выключен)
  func restored()                                        // после restore: бросить временное (пальцы, удержания, вспышки); id звёзд — по зеркалу
  func tick(now: Double, dt: Double)
  func idle()                                            // вызывает хост каждый кадр, пока мир не тикает (карта, переход)
  func draw(_ d: Draw, now: Double)
  func drawShot(_ d: Draw, now: Double)                  // кадр для снимка при уходе на карту: без предмета-угла (host/map.js mapShot)
  var objs: Int { get }                                  // число объектов мира для строки замеров (звёзды); на карте — 0
  func down(_ f: Finger)
  func move(_ f: Finger)
  func up(_ f: Finger)
  func cancel(_ f: Finger)                               // система отняла касание: бросить палец без действий тапа и удержания
}

extension World {
  var hasFx: Bool { fx != nil }
  func drawShot(_ d: Draw, now: Double) { draw(d, now: now) }
  var objs: Int { 0 }
  func enter() {}
  func scale(pcs: [Int]?, root: Int) {}
  func idle() {}                                         // карта: мир не тикает — слить то, что копится в ядре (кольцо heard)
}
