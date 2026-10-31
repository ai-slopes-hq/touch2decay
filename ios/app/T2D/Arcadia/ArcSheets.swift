import Foundation

// плашки Arcadia — заглушки задачи 6: веер и viator наполняются в задаче 7
extension ArcadiaView {
  private var emptySpec: SheetSpec {
    SheetSpec(title: "viator", hint: "wanderer — tap outside to close", rows: [], get: { _ in 0 }, set: { _, _ in }, text: { _ in "" },
              lfo: nil, reset: nil, arc: nil)
  }
  var fxSpec: SheetSpec { var s = emptySpec; s.title = "aether"; s.hint = "FX — tap outside to close"; return s }
  func viatorSpec(_ slot: Int) -> SheetSpec { emptySpec }
}
