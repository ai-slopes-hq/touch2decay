// Транспорт: внешние MIDI-часы и шаги секвенсеров. Порт host/midi.js (эталон — tools/ref/midi.js) один в один; время — секунды
// часов звука (в вебе — currentTime контекста, задаёт хост на каждый блок).
//   ClockParser — байты часов (0xF8 — 24 тика на долю, 0xFA / 0xFB — пуск, 0xFC — стоп) → сообщения: доля, темп, пуск, стоп.
//   Follower    — сетка долей {t0, p} по сообщениям (nextBeat: среднее 4 интервалов, прыжок > 50 мс — сразу, два согласных выброса —
//                 новый темп), пуск ждёт первую долю (cue), после стопа доли не слушаем до пуска (halted), без долей 1 с — сетки нет.
//                 Что делать мирам (кого запускать, кому темп) — решает хост по событиям Follower.
//   Steps       — шагомер мира-секвенсера (бывший autoSchedule): свой темп или по сетке, swing, смена деления на ходу; шаги ставятся
//                 внутри блока с точностью до сэмпла, опоздавший пропускается (первый после пуска — сразу).
#pragma once
#include <cmath>

namespace sdk {

constexpr double MIDI_JUMP = 0.05;      // ошибка доли больше — принять сразу
constexpr double MIDI_LOST = 1;         // секунд без долей — часы пропали
constexpr double LATE_FIRST = 0.03;     // первый шаг после пуска, опоздавший меньше, — играет сразу

struct Grid {                           // сетка долей: доля n — в t0 + n·p
  bool on = false;
  double t0 = 0, p = 0;
};
inline double stepTime(const Grid& g, double k, int perBeat) { return g.t0 + (k / perBeat) * g.p; }

// Часы для мира: время начала блока, частота и сетка (если есть). Даёт хост.
struct Clock {
  double now = 0, sr = 48000;
  Grid grid;
};

struct MidiMsg {
  enum Type { NONE, BEAT, TEMPO, START, STOP } t = NONE;
  double n = 0, bpm = 0;
};

class ClockParser {                     // clockParser: на вход — по одному байту с временем
 public:
  MidiMsg byte(int status, double at) {
    MidiMsg m;
    if (status == 0xF8) {
      if (cnt_ && at - ticks_[(head_ + cnt_ - 1) % CAP] > 0.5) cnt_ = 0;   // часы прерывались — темп заново
      if (cnt_ == CAP) { head_ = (head_ + 1) % CAP; cnt_--; }
      ticks_[(head_ + cnt_) % CAP] = at; cnt_++;
      const int n = cnt_ - 1;
      const double bpm = n >= 24 ? (60.0 * n) / 24 / (ticks_[(head_ + n) % CAP] - ticks_[head_]) : 0;
      if (count_ % 24 == 0) { m.t = run_ ? MidiMsg::BEAT : MidiMsg::TEMPO; m.n = count_ / 24; m.bpm = bpm; }   // раз в долю
      count_++;
    } else if (status == 0xFA || status == 0xFB) {
      run_ = true; if (status == 0xFA) count_ = 0;
      m.t = MidiMsg::START;
    } else if (status == 0xFC) { run_ = false; m.t = MidiMsg::STOP; }
    return m;
  }

 private:
  static constexpr int CAP = 97;
  double ticks_[CAP] = {};
  int head_ = 0, cnt_ = 0;
  long count_ = 0;
  bool run_ = false;
};

class Follower {
 public:
  enum Ev { NONE = 0, START = 1, STOP = 2, TEMPO = 3, BEAT = 4, LAUNCH = 5 };   // LAUNCH — первая доля после пуска: пора запускать миры
  // сообщение в момент at (сейчас — now); пишет события в ev (до 2), возвращает их число
  int message(const MidiMsg& m, double at, double now, int* ev, double* bpm) {
    int k = 0;
    if (g_.on && now < last_ - 0.05) g_.on = false;     // время пошло назад — сетка старых часов не годится
    *bpm = m.bpm;
    if (m.t == MidiMsg::START) { cue_ = true; halted_ = false; g_.on = false; ev[k++] = START; }
    else if (m.t == MidiMsg::STOP) { g_.on = false; cue_ = false; halted_ = true; ev[k++] = STOP; }
    else if (m.t == MidiMsg::TEMPO) { ev[k++] = TEMPO; }
    else if (m.t == MidiMsg::BEAT && !halted_ && (m.bpm > 0 || (g_.on && !cue_))) {   // первая доля без темпа сетку не строит
      if (cue_) g_.on = false;
      next(m.n, at, m.bpm);
      ev[k++] = BEAT;
      if (cue_) { cue_ = false; ev[k++] = LAUNCH; }
    }
    return k;
  }
  void tick(double now) {                               // раз в блок: время назад, часы пропали
    if (g_.on && (now < last_ - 0.05 || now > last_ + MIDI_LOST)) g_.on = false;
  }
  const Grid& grid() const { return g_; }

 private:
  void next(double n, double at, double bpm) {          // nextBeat
    if (!g_.on) {
      g_.on = true; g_.p = 60 / bpm; g_.t0 = at - n * g_.p; last_ = at; n_ = n; ni_ = 0; rej_ = false;
      return;
    }
    const bool wasRej = rej_;                           // выброс помнится ровно одну долю
    rej_ = false;
    if (n > n_) {
      const double iv = (at - last_) / (n - n_);
      if (iv >= 0.5 * g_.p && iv <= 2 * g_.p) push(iv);   // правдоподобный интервал
      else if (wasRej && std::fabs(iv - rv_) < 0.1 * iv) { ni_ = 0; push(rv_); push(iv); }   // два согласных выброса — новый темп
      else { rej_ = true; rv_ = iv; }
    }
    double p = g_.p;
    if (ni_) { double s = 0; for (int i = 0; i < ni_; i++) s += ints_[i]; p = s / ni_; }
    const double e = at - (g_.t0 + n * g_.p);
    const double target = std::fabs(e) > MIDI_JUMP ? at : at - e / 2;
    g_.t0 = target - n * p; g_.p = p; last_ = at; n_ = n;
  }
  void push(double iv) {
    if (ni_ == 4) { for (int i = 0; i < 3; i++) ints_[i] = ints_[i + 1]; ni_ = 3; }   // не больше 4: старый уходит
    ints_[ni_++] = iv;
  }
  Grid g_;
  double last_ = 0, n_ = 0, ints_[5] = {}, rv_ = 0;
  int ni_ = 0;
  bool rej_ = false, cue_ = false, halted_ = false;
};

// Когда играть шаг со временем t в блоке, который начинается в now: в будущем (или в этом блоке) — как есть; первый после пуска,
// чуть опоздавший, — сейчас; иначе пропустить (−1). В JS (host/midi.js due) шаги ставились на 200 мс вперёд по таймеру и порог был
// now + 3 мс; здесь шаг ставит сам блок, поэтому «в будущем» — с начала блока.
inline double dueAt(double t, double now, bool first) {
  if (t >= now) return t;
  if (first && now - t < LATE_FIRST) return now;
  return -1;
}

// Шагомер: run(now, end, grid, perBeat, dur, swing, fire) ставит все шаги, что начинаются до end. dur(step) — длина шага своим темпом,
// swing(step) — сдвиг шага от сетки, fire(step, t) — шаг прозвучит в t. Порядок и правила — autoSchedule прежнего engine.js.
class Steps {
 public:
  void reset() { next_ = 0; step_ = 0; lastAt_ = -1; lastPer_ = 0; armed_ = false; }
  long step() const { return step_; }
  double next() const { return next_; }
  template <class Dur, class Swing, class Fire>
  void run(double now, double end, const Grid& grid, int pb, Dur dur, Swing swing, Fire fire) {
    const bool g = grid.on && grid.p > 0;               // сетка с p ≤ 0 — не сетка
    if (!armed_) { next_ = now; armed_ = true; }
    if (lastPer_ && pb != lastPer_ && g) step_ = static_cast<long>(std::ceil(static_cast<double>(step_) * pb / lastPer_));
    lastPer_ = pb;
    const auto align = [&]() {
      if (!g) return;
      const long k = static_cast<long>(std::floor(((now - grid.t0) / grid.p) * pb)) - 1;
      if (k > step_) step_ = k;
      next_ = stepTime(grid, static_cast<double>(step_), pb);
    };
    align();
    for (int guard = 0; next_ < end && guard < 4096; guard++) {
      const double t = dueAt(g ? next_ + swing(step_) : next_, now, step_ == 0);
      if (t >= 0 && t > lastAt_) { lastAt_ = t; fire(step_, t); }
      if (!g) next_ += dur(step_);
      step_++;
      align();
    }
  }

 private:
  double next_ = 0, lastAt_ = -1;
  long step_ = 0;
  int lastPer_ = 0;
  bool armed_ = false;
};

}  // namespace sdk
