// Только для core/build-wasi.sh (wasi-sdk вместо emscripten). libc++ при сбое печатал бы в stderr — у нас просто ловушка
// (у emscripten то же сделано в wasm.cpp, там другое inline-пространство libc++). Импорты fd_write / fd_seek / fd_close от
// stdio wasi-libc остаются в модуле — их закрывают заглушки при инстанцировании (t2d-worklet.js, tools/t2d-core.mjs); вызываться не будут.
namespace std { inline namespace __1 {
void __libcpp_verbose_abort(const char*, ...) { __builtin_trap(); }
} }
