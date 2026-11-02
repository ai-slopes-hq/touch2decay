// Biquad — фильтр второго порядка: lowpass, highpass, bandpass, allpass.
//
// Формулы — как у BiquadFilterNode в Web Audio (они же — RBJ Audio EQ Cookbook). Так ядро звучит
// один в один с прежней веб-версией, а тест core/tests/sdk_test.cpp сверяет АЧХ с числами,
// посчитанными в Node по спецификации. Поменяешь формулу — тест упадёт, и это правильно.
//
// ЛОВУШКА — единицы Q зависят от типа (так в Web Audio):
//   lowpass, highpass — Q в децибелах: усиление ровно на частоте среза.
//       0 дБ ≈ Q 1 (лёгкий горб), −3 дБ ≈ Q 0.707 (Баттерворт, без горба), +12 дБ — заметный резонанс.
//       Например, set(highpass, 30, 1, sr) в host.cpp — это «1 дБ», а не «Q = 1».
//   bandpass, allpass — Q линейный: ширина полосы, больше — уже. Должен быть > 0, иначе деление на ноль.
//
// Чего фильтр не делает сам:
//   - не зажимает частоту: держи 0 < frequency < sampleRate / 2;
//   - не сглаживает смену параметров: резкий скачок среза может щёлкнуть.
//
// set() стоит дорого (cos, sin, pow) — зови его при смене параметра или раз в блок, не на каждый сэмпл.
// step() дешёвый — пять умножений.

#pragma once

#include <cmath>

namespace sdk {

struct Biquad {

  enum Type { lowpass, highpass, bandpass, allpass };

  // Коэффициенты, уже поделённые на a0 (поэтому a0 нигде не хранится — он равен 1).
  // Имена — стандартные из литературы по DSP: b — при входах, a — при выходах.
  // Тест читает их напрямую, чтобы посчитать АЧХ.
  double b0 = 1.0, b1 = 0.0, b2 = 0.0;
  double a1 = 0.0, a2 = 0.0;

  // Память фильтра: два последних входа и два последних выхода.
  // Схема — Direct Form I: хранит «сырые» прошлые сэмплы, а не их смесь с коэффициентами,
  // поэтому спокойнее переносит смену коэффициентов на ходу (свип среза, LFO).
  double previousInput = 0.0;
  double inputBeforePrevious = 0.0;
  double previousOutput = 0.0;
  double outputBeforePrevious = 0.0;

  // Забыть прошлое: следующий step() начнёт с тишины. Коэффициенты не трогает.
  // Нужен, когда звук обрывается и хвост фильтра не должен прозвучать в новом
  // (новая сцена, дека отзвучала и уснула).
  void reset() {
    previousInput = inputBeforePrevious = 0.0;
    previousOutput = outputBeforePrevious = 0.0;
  }

  // Память ровно в нуле — фильтр ничего не «дозвучивает». Так блоки (эхо) понимают,
  // что можно не считать тишину сэмпл за сэмплом. Сравнение точное: гасить крохотные
  // хвосты в 0 — забота того, кто проверяет.
  bool silent() const {
    return previousInput == 0.0 && inputBeforePrevious == 0.0
        && previousOutput == 0.0 && outputBeforePrevious == 0.0;
  }

  // Пересчитать коэффициенты. Память не сбрасывает — фильтр продолжает звучать с новыми настройками.
  //   frequency  — срез (lowpass, highpass) или центр (bandpass, allpass), Гц;
  //   q          — см. ЛОВУШКУ в шапке: для lowpass/highpass в дБ, для остальных линейный;
  //   sampleRate — частота дискретизации, Гц.
  void set(Type type, double frequency, double q, double sampleRate) {
    const double omega = 2.0 * M_PI * frequency / sampleRate;  // частота в радианах на сэмпл
    const double cosOmega = std::cos(omega);
    const double sinOmega = std::sin(omega);

    // alpha задаёт, насколько острый фильтр: меньше alpha — выше горб или уже полоса.
    // Децибелы переводим в линейный Q: 10^(дБ / 20).
    const bool qIsInDecibels = type == lowpass || type == highpass;
    const double linearQ = qIsInDecibels ? std::pow(10.0, q / 20.0) : q;
    const double alpha = sinOmega / (2.0 * linearQ);

    // Числитель (B) у каждого типа свой; знаменатель у всех четырёх общий:
    // a0 = 1 + alpha, a1 = −2·cos ω, a2 = 1 − alpha.
    double B0, B1, B2;
    switch (type) {
      case lowpass:
        B0 = (1.0 - cosOmega) / 2.0;
        B1 = 1.0 - cosOmega;
        B2 = B0;
        break;
      case highpass:
        B0 = (1.0 + cosOmega) / 2.0;
        B1 = -(1.0 + cosOmega);
        B2 = B0;
        break;
      case bandpass:  // на центральной частоте усиление ровно 1 (0 дБ) при любом Q
        B0 = alpha;
        B1 = 0.0;
        B2 = -alpha;
        break;
      case allpass:   // громкость не меняет, только сдвигает фазу: на центре — на 180°
      default:
        B0 = 1.0 - alpha;
        B1 = -2.0 * cosOmega;
        B2 = 1.0 + alpha;
        break;
    }

    // Делим всё на a0 один раз здесь, чтобы step() обходился без деления.
    const double a0 = 1.0 + alpha;
    b0 = B0 / a0;
    b1 = B1 / a0;
    b2 = B2 / a0;
    a1 = -2.0 * cosOmega / a0;
    a2 = (1.0 - alpha) / a0;
  }

  // Пропустить один сэмпл через фильтр. Звать подряд на каждый сэмпл потока:
  // выход зависит от прошлых вызовов. Один экземпляр — один канал (для стерео — два фильтра).
  double step(double input) {
    const double output = b0 * input + b1 * previousInput + b2 * inputBeforePrevious
                        - a1 * previousOutput - a2 * outputBeforePrevious;

    inputBeforePrevious = previousInput;
    previousInput = input;
    outputBeforePrevious = previousOutput;
    previousOutput = output;

    return output;
  }
};

}  // namespace sdk
