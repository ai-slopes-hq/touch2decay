// Только emscripten-часть моста: ловушки вместо libc++/libc, что печатают в stderr или зовут WASI. Сами экспорты — в api.cpp (общий с iOS).
// libc++ при сбое (нет памяти под строку снимка) печатает в stderr — это тянуло бы импорты WASI (fd_write …); у нас — просто ловушка.
// Только для emscripten (inline-пространство __2 у его libc++); без него (core/build-wasi.sh) то же — в core/bridge/wasi.cpp
#ifdef __EMSCRIPTEN__
namespace std { inline namespace __2 {
[[noreturn]] void __libcpp_verbose_abort(const char*, ...) noexcept { __builtin_trap(); }
} }
#endif
// старый emscripten (3.1.6): abort → _Exit → импорт WASI proc_exit; модуль без импортов — тоже ловушка
extern "C" void _Exit(int) { __builtin_trap(); }
