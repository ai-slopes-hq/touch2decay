// Resonator — двухполюсный резонатор: звенит на одной частоте и затухает. Ударил импульсом —
// получил затухающую синусоиду. Из таких мод собраны пластина Cymatica и звон Horologium.
//
//   y = b1·y_прошлый + b2·y_позапрошлый + g·x,   полюса R·e^(±iω), ω = 2π·hz/fs
//
// Коэффициенты (ResCoef) хранятся отдельно от состояния (Resonator): мод у мира много
// (моды × голоса), а коэффициенты меняются только со сменой высоты, не каждый сэмпл.
// Затухание — одним из способов:
//   ResCoef::t60(hz, T60, fs)  — за T60 секунд звон стихает на 60 дБ: R = 10^(−3/(T60·fs)) (Cymatica);
//   ResCoef::tau(hz, τ, fs)    — огибающая e^(−t/τ): R = e^(−1/(τ·fs)) (Horologium);
//   ResCoef::fromR(hz, R, fs)  — R задан прямо.
//
// ЛОВУШКИ:
//   - Усиление g — у вызывающего, блок громкость не нормирует. Cymatica берёт g = sin ω: тогда
//     единичный импульс даёт амплитуду ~1. Без этого громкость сильно зависит от частоты.
//   - R ≥ 1 — звон не затихает или растёт. hz выше fs/2 звучит зеркально ниже.
//   - Резонатор копит: долгое возбуждение на его частоте при R близком к 1 даёт большую амплитуду.
// Цена — три умножения на сэмпл; cos и pow/exp — только в ResCoef.
#pragma once
#include <cmath>

namespace sdk {

struct ResCoef {
  double b1 = 0, b2 = 0;
  static ResCoef fromR(double hz, double R, double fs) {
    const double w = (2 * 3.141592653589793 * hz) / fs;
    return {2 * R * std::cos(w), -R * R};
  }
  static ResCoef t60(double hz, double t60, double fs) { return fromR(hz, std::pow(10.0, -3 / (t60 * fs)), fs); }
  static ResCoef tau(double hz, double tau, double fs) { return fromR(hz, std::exp(-1 / (tau * fs)), fs); }
};

struct Resonator {
  double previousOutput = 0, outputBeforePrevious = 0;

  double step(const ResCoef& c, double g, double x) {
    const double y = c.b1 * previousOutput + c.b2 * outputBeforePrevious + g * x;
    outputBeforePrevious = previousOutput; previousOutput = y;
    return y;
  }
  void reset() { previousOutput = outputBeforePrevious = 0; }   // замолчать сразу (щёлкнет, если звенел)
  // скорость колебания: разность двух последних выходов (смычок Cymatica трёт с этой скоростью)
  double velocity() const { return previousOutput - outputBeforePrevious; }
};

}  // namespace sdk
