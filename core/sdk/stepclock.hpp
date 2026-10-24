// Часы секвенсера на сэмплах: шаг — шестнадцатая. Считает, на каком сэмпле блока наступает следующий шаг, от темпа (bpm) или от сетки
// MIDI-часов { t0, p } (время ядра в секундах: t0 — узел сетки, p — длительность доли), и держит счёт сэмплов.
// Что играет шаг — у мира: часы только говорят «пора». Порядок на каждый сэмпл блока:
//   clock.begin();  for k: { if (clock.due()) { …шаг мира…; clock.rearm(k); }  clock.advance(); }
// Тихий блок (мир не считается) — clock.skip(n). Время ядра — t/fs от prepare: сообщения мира приходят между блоками, на границе.
// Выверено со старым plate-worklet.js (stepSamples, setSeq, setLock, nextTickFrame); округление — как Math.round (половина вверх).
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace sdk {

inline double jsRound(double x) { const double r = std::floor(x); return x - r >= 0.5 ? r + 1 : r; }

// отсчётов на шаг (шестнадцатую) при bpm
inline int64_t stepSamples(double bpm, double fs) { return static_cast<int64_t>(jsRound((fs * 60) / bpm / 4)); }

// отсчётов от момента t (с) до ближайшей шестнадцатой сетки t0 + j·p/4 строго после t; не меньше 1.
// «Строго после» — с запасом в отсчёт: t — округлённый до отсчёта узел прошлого тика, он бывает раньше настоящего узла на полотсчёта
inline int64_t nextTickFrame(double t, double t0, double p, double fs) {
  const double q = p / 4, j = std::floor((t + 0.6 / fs - t0) / q) + 1;
  return std::max<int64_t>(1, static_cast<int64_t>(jsRound((t0 + j * q - t) * fs)));
}

class StepClock {
 public:
  void prepare(double fs) { *this = StepClock(); fs_ = fs; stepN_ = stepSamples(bpm_, fs); }

  // темп и ход, как setSeq у пластины. true — часы только что пошли (мир сбрасывает счёт шагов: первый тик — шаг 0)
  bool set(bool playing, double bpm) {
    const bool was = playing_;
    playing_ = playing; bpm_ = bpm;
    const int64_t stepN = lock_ ? stepSamples(60 / lockP_, fs_) : stepSamples(bpm, fs_);
    bool started = false;
    if (playing_ && !was) {
      started = true; ticked_ = false; toNext_ = 0;
      if (lock_) {                                       // пуск при сетке: шаг 0 — на узле; опоздал меньше 30 мс — сразу, иначе на следующем
        const double now = static_cast<double>(t_) / fs_, q = lockP_ / 4, d = now - lockT0_, ph = d - std::floor(d / q) * q;
        if (ph >= 0.03) toNext_ = nextTickFrame(now, lockT0_, lockP_, fs_);
      }
    } else if (playing_ && !lock_ && stepN != stepN_) {
      toNext_ = std::max<int64_t>(0, stepN - (t_ - lastTick_));
    }
    stepN_ = stepN;
    return started;
  }

  // сетка MIDI-часов (как setLock): off или p ≤ 0 — тики по темпу. Прыжок сетки сдвигает только момент тика, счёт шагов не трогаем;
  // не раньше полушага после прошлого тика — иначе сдвиг сетки на ε дал бы двойной тик
  void lock(bool off, double t0, double p) {
    const bool was = lock_;
    lock_ = !off && p > 0; lockT0_ = t0; lockP_ = p;
    stepN_ = stepSamples(lock_ ? 60 / lockP_ : bpm_, fs_);
    if (!playing_ || !ticked_) return;
    if (!lock_) { if (was) toNext_ = std::max<int64_t>(0, stepN_ - (t_ - lastTick_)); return; }
    const double now = static_cast<double>(t_) / fs_, last = now - static_cast<double>(t_ - lastTick_) / fs_, from = std::max(now, last + lockP_ / 8);
    toNext_ = nextTickFrame(from, lockT0_, lockP_, fs_) + static_cast<int64_t>(jsRound((from - now) * fs_));
  }

  void begin() { block0_ = t_; }                         // начало блока: время для сетки внутри него — от этого сэмпла
  bool due() { return playing_ && --toNext_ < 0; }       // этот сэмпл — шаг
  void rearm(int k) {                                    // после шага на сэмпле k блока: когда следующий
    lastTick_ = t_; ticked_ = true;
    if (lock_) toNext_ = nextTickFrame(static_cast<double>(block0_) / fs_ + k / fs_, lockT0_, lockP_, fs_) - 1;
    else toNext_ += stepN_;
  }
  void advance() { ++t_; }
  void skip(int n) { t_ += n; }

  bool playing() const { return playing_; }
  bool locked() const { return lock_; }
  int64_t t() const { return t_; }
  int64_t stepN() const { return stepN_; }
  int64_t sinceTick() const { return t_ - lastTick_; }

 private:
  double fs_ = 48000, bpm_ = 96, lockT0_ = 0, lockP_ = 0;
  bool playing_ = false, lock_ = false, ticked_ = false;
  int64_t t_ = 0, block0_ = 0, stepN_ = 0, toNext_ = 0, lastTick_ = 0;
};

}  // namespace sdk
