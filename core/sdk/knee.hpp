// Knee — мягкое колено: ограничитель без хрипа. Ниже порога сигнал проходит как есть,
// выше — плавно прижимается к потолку threshold + room.
//
//   y = |gain·x|;  y < threshold — y;  иначе — threshold + room·tanh((y − threshold)/room);
//   знак выхода — знак x (кривая нечётная).
//
// Кто как настраивает (порядок полей — gain, threshold, room):
//   - мастер хоста (core/host/host.cpp, было host/audio.js knee): gain = 2.6/tanh 2.6, threshold 0.6,
//     room = потолок − threshold = 0.98 − 0.6;
//   - выход пластины Cymatica (outKnee): gain 1, threshold 0.8, room 0.8.
//
// ЛОВУШКИ:
//   - Не заменять сплошным tanh: он давал хрип (искажения до −16 дБ на нижних нотах).
//   - Выход никогда не выше threshold + room — это и есть потолок.
//   - room должен быть > 0: на него делим.
// Цена — модуль на сэмпл и tanh только выше порога; состояния нет.
#pragma once
#include <cmath>

namespace sdk {

struct Knee {
  double gain = 1, threshold = 0.8, room = 0.8;

  double operator()(double x) const {
    const double level = std::fabs(gain * x);
    const double sign = x < 0 ? -1 : x > 0 ? 1 : 0;
    return sign * (level < threshold ? level : threshold + room * std::tanh((level - threshold) / room));
  }
};

}  // namespace sdk
