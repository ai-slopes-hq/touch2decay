// Param — значение, которое меняется по расписанию: то же, что AudioParam в Web Audio.
// Миры, жившие на узлах Web Audio (Tria, Tenebrae), писали «через 0.3 с — линейно к 0.8»,
// «плавно к нулю за 50 мс»; Param проигрывает такое расписание по сэмплам и звучит как браузер.
// Сверено с OfflineAudioContext Chromium: tools/param-check.py (сценарии — через core/tests/param_cli.cpp).
//
//   sdk::Param gain(0);                     // значение, пока событий нет
//   gain.set(0.2, now);                     // сразу 0.2
//   gain.lin(0.8, now + 0.3 * sr);          // линейно к 0.8 за 0.3 с
//   gain.target(0, now + sr, 0.05 * sr);    // через 1 с — к нулю с постоянной 50 мс
//   gain.fill(buf, n, now);                 // значения на n сэмплов вперёд
//
// ЛОВУШКИ:
//   - Время событий и tau — в СЭМПЛАХ мира (double, можно дробное), не в секундах.
//   - fill и step зовут подряд, без пропусков: fill(…, t0) считает кадры t0 … t0 + n − 1,
//     следующий fill — с t0 + n.
//   - Событий в очереди не больше CAP (16). Лишние молча отбрасываются.
//   - Сумму a-rate входов (FM в частоту) Param не знает — прибавляй её сам.
//
// Как ведут себя события (как в спецификации Web Audio и в Chromium, AudioParamTimeline):
//   - Время в прошлом считается «сейчас». Событие действует с первого кадра, чьё время ≥ t.
//   - Два события на одно время не заменяют друг друга: новое встаёт после старого (так в Chromium).
//   - lin / exp — рампа от предыдущего события к своему (v, t): начало — время и значение предыдущего
//     (у set — его значение, у рампы — её конец).
//       · Если сейчас идёт target, рампа стартует от «сейчас» и от того, где target сейчас.
//       · Если target ещё не начался, рампа встаёт вместо него (от значения перед ним).
//   - exp: v0·(v1/v0)^((t − t0)/(t1 − t0)). Если v0 = 0 или у v0 и v1 разные знаки — держит v0
//     до t1 (так в спецификации; Chromium здесь ведёт себя иначе, поэтому миры так не делают).
//   - target(v, t, tau): с момента t ползёт к v, за tau проходит ~63 % пути.
//       · Стартовое значение — где была прежняя кривая на кадре t (дошедшая рампа или set — их значение,
//         идущий target — ещё один его шаг); если t между кадрами — последнее посчитанное.
//       · Первый кадр — точной формулой v + (v0 − v)·e^(−(f − t)/tau), дальше — шагом на кадр:
//         y += (v − y)·(1 − e^(−1/tau)).
//       · Chromium считает эти шаги во float, мы — в double; разница меньше 1e-6, сверка проходит.
//       · В начале fill, если впереди нет событий и target «дошёл» (прошло больше 10·tau или осталось
//         меньше e^(−10) от цели; у нуля — |v| < e^(−10)), значение встаёт ровно в цель и дальше
//         не считается (HasSetTargetConverged в Chromium).
//   - cancel(t) снимает события со временем ≥ t, которые ещё не начались (у рампы время — её конец;
//     идущий target продолжает идти). Значение остаётся там, где было: снятая рампа не прыгает
//     обратно к своему началу (так в Chromium).

#pragma once

#include <cmath>

namespace sdk {

class Param {
 public:
  static constexpr int CAP = 16;  // событий в очереди, больше — отбрасываются
  enum Kind : unsigned char { SET, LIN, EXP, TARGET };

  explicit Param(double v = 0) { reset(v); }
  // Забыть все события и держать v.
  void reset(double v) { held_ = value_ = startValue_ = v; startTime_ = 0; count_ = 0; targetRunning_ = false; now_ = 0; }

  void set(double v, double t) { put(SET, v, t, 0); }                        // в момент t — сразу v
  void lin(double v, double t) { put(LIN, v, t, 0); }                        // к моменту t — линейно до v
  void exp(double v, double t) { put(EXP, v, t, 0); }                        // к моменту t — экспонентой до v
  void target(double v, double t, double tau) { put(TARGET, v, t, tau); }   // с момента t — ползти к v (tau в сэмплах)

  // Снять события, которые начинаются в t или позже (см. шапку).
  void cancel(double t) {
    t = t < now_ ? now_ : t;
    int keep = 0;
    while (keep < count_ && events_[keep].time < t) keep++;
    if (keep == 0 && count_ && (events_[0].kind == LIN || events_[0].kind == EXP)) held_ = value_;  // идущая рампа снята — держим, где она сейчас
    count_ = keep;
  }

  double value() const { return value_; }                          // последнее посчитанное значение (кадр now − 1)
  bool idle() const { return count_ == 0 && !targetRunning_; }    // значение постоянное — fill просто копирует

  // Значения на кадры t0 … t0 + n − 1.
  void fill(double* out, int n, double t0) {
    if (targetRunning_ && !count_ && targetConverged(t0)) { targetRunning_ = false; held_ = targetValue_; }
    if (idle()) {
      for (int k = 0; k < n; k++) out[k] = held_;
      value_ = held_;
      now_ = t0 + n;
      return;
    }
    for (int k = 0; k < n; k++) out[k] = step(t0 + k);
    now_ = t0 + n;
  }

  // Значение на кадре f (кадры подряд). Обычно зовётся из fill.
  double step(double f) {
    // Сначала применить все события, чьё время пришло; найти рампу, которая сейчас идёт.
    const Event* ramp = nullptr;
    while (count_) {
      const Event& e = events_[0];
      if (e.kind == LIN || e.kind == EXP) {
        if (f < e.time) { ramp = &e; break; }
        held_ = startValue_ = e.value;  // рампа дошла: дальше её конец — точка отсчёта
        startTime_ = e.time;
        targetRunning_ = false;
        pop();
        continue;
      }
      if (f < e.time) break;
      startTime_ = e.time;
      if (e.kind == SET || e.tau <= 0) {
        held_ = startValue_ = e.value;
        targetRunning_ = false;
      } else {
        startValue_ = f == e.time ? valueOnThisFrame() : value_;
        targetValue_ = e.value;
        targetCoef_ = 1 - std::exp(-1 / e.tau);
        targetRunning_ = true;
        targetFirstFrame_ = true;
        targetStart_ = e.time;
        targetTau_ = e.tau;
      }
      pop();
    }

    double v;
    if (ramp) {
      const double x = (f - startTime_) / (ramp->time - startTime_);  // доля пути рампы, 0…1
      if (ramp->kind == LIN) v = startValue_ + (ramp->value - startValue_) * x;
      else v = (startValue_ == 0 || (startValue_ > 0) != (ramp->value > 0)) ? startValue_ : startValue_ * std::pow(ramp->value / startValue_, x);
    } else if (targetRunning_) {
      if (targetFirstFrame_) v = targetValue_ + (startValue_ - targetValue_) * std::exp(-(f - targetStart_) / targetTau_);
      else v = value_ + (targetValue_ - value_) * targetCoef_;
      targetFirstFrame_ = false;
    } else {
      v = held_;
    }
    value_ = v;
    return v;
  }

 private:
  struct Event { Kind kind; double time, value, tau; };

  static constexpr double kConverged = 4.539992976248485e-05;  // e^(−10): ближе к цели — считаем, что дошли

  bool targetConverged(double f) const {
    if (f - targetStart_ > 10 * targetTau_) return true;
    if (targetValue_ == 0) return std::fabs(value_) < kConverged;
    return std::fabs(value_ - targetValue_) < kConverged * std::fabs(targetValue_);
  }

  // Где прежняя кривая на текущем кадре: идущий target — ещё один его шаг, иначе — то, что держим.
  double valueOnThisFrame() const { return targetRunning_ ? value_ + (targetValue_ - value_) * targetCoef_ : held_; }

  void pop() { for (int k = 1; k < count_; k++) events_[k - 1] = events_[k]; count_--; }

  // Вставить событие по времени; на одно время — после уже стоящих.
  void put(Kind kind, double v, double t, double tau) {
    if (t < now_) t = now_;
    int at = 0;
    while (at < count_ && events_[at].time <= t) at++;
    if (count_ == CAP) return;
    if (at == 0 && targetRunning_ && (kind == LIN || kind == EXP)) {  // рампа после идущего target — от «сейчас»
      startTime_ = now_;
      startValue_ = valueOnThisFrame();
    }
    for (int j = count_; j > at; j--) events_[j] = events_[j - 1];
    events_[at] = {kind, t, v, tau};
    count_++;
  }

  Event events_[CAP];
  int count_ = 0;
  double now_ = 0;          // первый ещё не посчитанный кадр

  double value_ = 0;        // последнее посчитанное значение
  double held_ = 0;         // что держим, когда ничего не идёт
  double startValue_ = 0;   // откуда идёт текущий участок (рампа или target): значение…
  double startTime_ = 0;    // …и время

  bool targetRunning_ = false, targetFirstFrame_ = false;
  double targetValue_ = 0;  // куда ползёт target
  double targetCoef_ = 0;   // доля пути за кадр: 1 − e^(−1/tau)
  double targetStart_ = 0;  // когда target начался
  double targetTau_ = 1;    // его tau, сэмплов
};

}  // namespace sdk
