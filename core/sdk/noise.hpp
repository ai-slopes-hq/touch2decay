// Noise — цветные шумы, на лету от Rng (без буферов):
//
//   white   — белый, ±0.5;
//   pink    — розовый (−3 дБ на октаву): белый через три однополюсных фильтра, «экономный» вариант Пола Келлета;
//   brown   — коричневый (−6 дБ на октаву): интеграл белого с утечкой, зажат в ±1;
//   crackle — треск: редкие щелчки случайного знака (~72 в секунду при 48 кГц), каждый гаснет за ~1 мс;
//   grain   — зерно: всплески белого по 10–40 мс с плавной огибающей (~2 мс), примерно 13 в секунду.
//
// Уровни и константы — как буферы шума в engine.js Inferno (решение автора 24.10: шумы — в SDK).
// Состояние у каждого Noise своё, случайность — Rng вызывающего (зерно мира).
//
// ЛОВУШКИ:
//   - set(c) обнуляет состояние: смена цвета на ходу — скачок (у brown слышно щелчком).
//   - Сколько раз next() дёргает Rng, зависит от цвета и случая (треск и зерно — больше одного). Rng мира общий —
//     поменяешь порядок вызовов, и всё случайное дальше пойдёт иначе: сверки с эталоном разойдутся.
//   - sr нужен только зерну (длина всплеска); при другой частоте дискретизации треск и зерно реже или чаще.
// Цена — от одного до четырёх Rng::next и несколько умножений на сэмпл.
#pragma once
#include <cmath>
#include "rng.hpp"

namespace sdk {

struct Noise {
  enum Color { white, pink, brown, crackle, grain, NCOLORS };
  int color = white;
  double pinkSlow = 0, pinkMid = 0, pinkFast = 0;       // три полюса розового: 0.99765, 0.963, 0.57
  double brownLevel = 0, crackleLevel = 0, grainEnv = 0;
  int grainLeft = 0;                                    // сколько сэмплов осталось у текущего всплеска зерна

  void set(int c) {
    color = c < 0 ? 0 : c >= NCOLORS ? NCOLORS - 1 : c;
    pinkSlow = pinkMid = pinkFast = brownLevel = crackleLevel = grainEnv = 0; grainLeft = 0;
  }
  double next(Rng& r, double sr) {
    const double x = r.next() * 2 - 1;
    switch (color) {
      case pink:
        pinkSlow = 0.99765 * pinkSlow + x * 0.099046; pinkMid = 0.963 * pinkMid + x * 0.2965164; pinkFast = 0.57 * pinkFast + x * 1.0526913;
        return (pinkSlow + pinkMid + pinkFast + x * 0.1848) * 0.11;
      case brown:
        brownLevel = (brownLevel + x * 0.02 > 1 ? 1 : brownLevel + x * 0.02 < -1 ? -1 : brownLevel + x * 0.02) * 0.998;
        return brownLevel * 1.6;
      case crackle:
        if (r.next() < 0.0015) crackleLevel = (r.next() < 0.5 ? -1 : 1) * (0.4 + r.next() * 0.6);
        crackleLevel *= 0.9;
        return crackleLevel;
      case grain:
        if (grainLeft <= 0 && r.next() < 0.0004) grainLeft = static_cast<int>(std::floor(sr * (0.01 + r.next() * 0.03) + 0.5));
        grainEnv += ((grainLeft > 0 ? 1 : 0) - grainEnv) * 0.01;
        if (grainLeft > 0) grainLeft--;
        return x * grainEnv * 0.8;
      default: return x * 0.5;
    }
  }
};

}  // namespace sdk
