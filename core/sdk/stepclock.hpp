// StepClock — часы секвенсера в сэмплах: шаг = шестнадцатая. Говорят, на каком сэмпле блока наступает следующий шаг;
// что играет шаг — решает мир, часы только говорят «пора». Сейчас ими пользуется Cymatica (core/worlds/cymatica/plate.hpp);
// миры, которым нужны шаги по времени в секундах и swing, берут Steps из transport.hpp.
//
// Два режима:
//   по темпу   — шаг = round(fs·60 / bpm / 4) сэмплов, сменили темп на ходу — следующий шаг сдвигается, счёт не сбивается;
//   по сетке   — сетка MIDI-часов { t0, p } (секунды ядра: t0 — узел доли, p — длительность доли), шаги на t0 + j·p/4.
//
// Порядок вызовов на каждый блок:
//   clock.begin();
//   for k in 0…n−1: { if (clock.due()) { …шаг мира…; clock.rearm(k); }  clock.advance(); }
// Тихий блок (мир его не считает) — clock.skip(n): время идёт, шагов нет. Время ядра — t/fs от prepare; set и lock приходят
// между блоками, то есть на границе блока.
//
// Выверено со старым plate-worklet.js (stepSamples, setSeq, setLock, nextTickFrame), тест — core/tests/sdk_test.cpp.
//
// ЛОВУШКИ:
//   - Округление — как Math.round (половина вверх, jsRound), не std::round: иначе шаги разъедутся с вебом на сэмпл.
//   - set() возвращает true ровно в момент пуска — мир сам обнуляет свой счёт шагов (первый тик — шаг 0).
//   - Прыжок сетки сдвигает только момент следующего шага, номер шага часы не знают и не трогают.
//   - bpm ≤ 0 и p ≤ 0 не проверяются в stepSamples: lock(·, ·, p ≤ 0) сам выключает сетку, bpm — забота мира.
// Цена — декремент и сравнение на сэмпл; на шаг по сетке — floor и round.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>

#include "jsmath.hpp"                                   // jsRound — Math.round

namespace sdk {

// сэмплов на шаг (шестнадцатую) при темпе bpm
inline int64_t stepSamples(double bpm, double fs) { return static_cast<int64_t>(jsRound((fs * 60) / bpm / 4)); }

// сэмплов от момента t (с) до ближайшего узла шестнадцатых t0 + j·p/4 строго после t; не меньше 1.
// «Строго после» — с запасом 0.6 сэмпла: t — это узел прошлого шага, округлённый до сэмпла, и он бывает на полсэмпла раньше
// настоящего узла — без запаса тот же узел нашёлся бы второй раз
inline int64_t nextTickFrame(double t, double t0, double p, double fs) {
  const double q = p / 4, j = std::floor((t + 0.6 / fs - t0) / q) + 1;
  return std::max<int64_t>(1, static_cast<int64_t>(jsRound((t0 + j * q - t) * fs)));
}

class StepClock {
 public:
  // сбросить всё и встать на частоту fs; темп — по умолчанию 96, стоим
  void prepare(double fs) { *this = StepClock(); sr_ = fs; stepLen_ = stepSamples(bpm_, fs); }

  // ход и темп (как setSeq у пластины). true — часы только что пошли: мир обнуляет счёт шагов
  bool set(bool playing, double bpm) {
    const bool wasPlaying = playing_;
    playing_ = playing; bpm_ = bpm;
    const int64_t len = locked_ ? stepSamples(60 / gridBeat_, sr_) : stepSamples(bpm, sr_);
    bool started = false;
    if (playing_ && !wasPlaying) {
      started = true; stepped_ = false; untilStep_ = 0;  // шаг 0 — на этом же сэмпле
      if (locked_) {                                     // пуск при сетке: шаг 0 — на узле; опоздали меньше 30 мс — сразу, иначе ждём следующий
        const double now = static_cast<double>(now_) / sr_, q = gridBeat_ / 4, d = now - gridT0_, late = d - std::floor(d / q) * q;
        if (late >= 0.03) untilStep_ = nextTickFrame(now, gridT0_, gridBeat_, sr_);
      }
    } else if (playing_ && !locked_ && len != stepLen_) {   // сменили темп на ходу: отсчёт от прошлого шага новой длиной
      untilStep_ = std::max<int64_t>(0, len - (now_ - lastStep_));
    }
    stepLen_ = len;
    return started;
  }

  // сетка MIDI-часов (как setLock): off или p ≤ 0 — шаги по своему темпу. Прыжок сетки двигает только момент следующего шага,
  // и не раньше полушага после прошлого: иначе сдвиг сетки на ε дал бы двойной шаг
  void lock(bool off, double t0, double p) {
    const bool wasLocked = locked_;
    locked_ = !off && p > 0; gridT0_ = t0; gridBeat_ = p;
    stepLen_ = stepSamples(locked_ ? 60 / gridBeat_ : bpm_, sr_);
    if (!playing_ || !stepped_) return;                  // до первого шага пересчитывать нечего
    if (!locked_) { if (wasLocked) untilStep_ = std::max<int64_t>(0, stepLen_ - (now_ - lastStep_)); return; }
    const double now = static_cast<double>(now_) / sr_, last = now - static_cast<double>(now_ - lastStep_) / sr_, from = std::max(now, last + gridBeat_ / 8);
    untilStep_ = nextTickFrame(from, gridT0_, gridBeat_, sr_) + static_cast<int64_t>(jsRound((from - now) * sr_));
  }

  void begin() { blockStart_ = now_; }                   // начало блока: узлы сетки внутри него считаем от этого сэмпла
  bool due() { return playing_ && --untilStep_ < 0; }    // на этом сэмпле — шаг
  void rearm(int k) {                                    // после шага на сэмпле k блока: когда следующий
    lastStep_ = now_; stepped_ = true;
    if (locked_) untilStep_ = nextTickFrame(static_cast<double>(blockStart_) / sr_ + k / sr_, gridT0_, gridBeat_, sr_) - 1;
    else untilStep_ += stepLen_;
  }
  void advance() { ++now_; }                             // конец сэмпла
  void skip(int n) { now_ += n; }                        // тихий блок целиком

  bool playing() const { return playing_; }
  bool locked() const { return locked_; }                // идём по сетке MIDI
  int64_t t() const { return now_; }                     // сэмплов с prepare
  int64_t stepN() const { return stepLen_; }             // сэмплов на шаг сейчас
  int64_t sinceTick() const { return now_ - lastStep_; } // сэмплов с прошлого шага

 private:
  double sr_ = 48000, bpm_ = 96;
  double gridT0_ = 0, gridBeat_ = 0;                     // сетка MIDI: узел доли (с) и длина доли (с)
  bool playing_ = false, locked_ = false;
  bool stepped_ = false;                                 // после пуска уже был шаг
  int64_t now_ = 0;                                      // сэмплов с prepare
  int64_t blockStart_ = 0;                               // now_ на начале блока
  int64_t stepLen_ = 0;                                  // сэмплов на шаг
  int64_t untilStep_ = 0;                                // сэмплов до шага; due() срабатывает, когда уходит ниже нуля
  int64_t lastStep_ = 0;                                 // now_ прошлого шага
};

}  // namespace sdk
