// Транспорт: внешние MIDI-часы и шаги секвенсеров. Порт host/midi.js (эталон — tools/ref/midi.js) один в один; время везде —
// секунды часов звука (в вебе — currentTime контекста, хост задаёт его на каждый блок).
//
//   байты MIDI ──→ ClockParser ──→ MidiMsg (доля, темп, пуск, стоп) ──→ Follower ──→ Grid {t0, p} + события ──→ хост
//                                                                                        │
//                                         Clock {now, sr, grid} — хост даёт миру ←───────┘
//                                         Steps — шагомер мира: ставит шаги по своему темпу или по Grid
//
//   ClockParser — байты часов (0xF8 — 24 тика на долю, 0xFA / 0xFB — пуск / продолжить, 0xFC — стоп) → по сообщению на долю.
//   Follower    — держит сетку долей: темп — среднее 4 последних интервалов; ошибка доли больше 50 мс — принять сразу, иначе
//                 подтянуть наполовину; одиночный странный интервал — выброс, два согласных подряд — новый темп. Пуск ждёт
//                 первую долю (тогда событие LAUNCH), после стопа доли не слушаем до пуска, без долей 1 с — сетки нет.
//                 Кого запускать и кому темп — решает хост по событиям (core/host/host.cpp).
//   Steps       — шагомер мира-секвенсера (бывший autoSchedule из engine.js): свой темп или по сетке, swing, смена деления доли
//                 на ходу; шаг ставится внутри блока с точностью до сэмпла, опоздавший пропускается (кроме первого после пуска).
//                 Им пользуются Monochordum, Portus, Natura.
//
// ЛОВУШКИ:
//   - Темп ClockParser даёт только после 25 тиков (24 интервала — доля); до того bpm = 0, и первая доля сетку не строит.
//   - Перерыв в тиках больше 0.5 с — темп считается заново; время назад больше 50 мс — сетка сбрасывается.
//   - Steps.run без сетки шагает по dur(step), с сеткой — по сетке, а dur не зовёт; swing — только с сеткой.
// Цена — копейки: ClockParser и Follower — на байт / сообщение, Steps.run — раз в блок, цикл по шагам блока.
#pragma once
#include <cmath>

namespace sdk {

constexpr double MIDI_JUMP = 0.05;      // ошибка доли больше — принять сразу, не подтягивать
constexpr double MIDI_LOST = 1;         // секунд без долей — часы пропали
constexpr double LATE_FIRST = 0.03;     // первый шаг после пуска, опоздавший меньше, — играет сразу

struct Grid {                           // сетка долей: доля n — в t0 + n·p (секунды)
  bool on = false;
  double t0 = 0, p = 0;
};
// момент шага k при perBeat шагах на долю
inline double stepTime(const Grid& g, double k, int perBeat) { return g.t0 + (k / perBeat) * g.p; }

// Мастер-сетка хоста: идёт всегда, даже без MIDI. Темп меняется без скачка фазы (номер доли в момент смены тот же);
// внешняя сетка Follower её перекрывает — мастер её перенимает (adopt) и после стопа идёт дальше с тем же темпом и фазой.
struct MasterClock {
  double bpm = 100, t0 = 0, p = 0.6;
  Grid grid() const { Grid g; g.on = true; g.t0 = t0; g.p = p; return g; }
  void setBpm(double b, double now) {
    const double n = (now - t0) / p;
    p = 60 / b; bpm = b; t0 = now - n * p;
  }
  void adopt(const Grid& g) { t0 = g.t0; p = g.p; bpm = 60 / p; }
};

// Часы для мира: время начала блока (с), частота и сетка (если есть). Даёт хост перед каждым блоком.
struct Clock {
  double now = 0, sr = 48000;
  Grid grid;
};

// t — что пришло; n — номер доли от пуска (BEAT, TEMPO); bpm — темп по тикам, 0 — ещё не знаем
struct MidiMsg {
  enum Type { NONE, BEAT, TEMPO, START, STOP } t = NONE;
  double n = 0, bpm = 0;
};

class ClockParser {                     // clockParser: на вход — по одному байту с временем прихода
 public:
  // байт status пришёл в момент at; сообщение — на каждый 24-й тик (BEAT при ходе, TEMPO при стопе), на пуск и стоп; иначе NONE
  MidiMsg byte(int status, double at) {
    MidiMsg m;
    if (status == 0xF8) {
      if (kept_ && at - tickAt_[(first_ + kept_ - 1) % KEEP] > 0.5) kept_ = 0;   // часы прерывались — темп заново
      if (kept_ == KEEP) { first_ = (first_ + 1) % KEEP; kept_--; }               // кольцо полно — старый тик уходит
      tickAt_[(first_ + kept_) % KEEP] = at; kept_++;
      const int spans = kept_ - 1;                       // интервалов между хранимыми тиками
      const double bpm = spans >= 24 ? (60.0 * spans) / 24 / (tickAt_[(first_ + spans) % KEEP] - tickAt_[first_]) : 0;
      if (ticks_ % 24 == 0) { m.t = running_ ? MidiMsg::BEAT : MidiMsg::TEMPO; m.n = ticks_ / 24; m.bpm = bpm; }   // раз в долю
      ticks_++;
    } else if (status == 0xFA || status == 0xFB) {     // 0xFA — с начала (счёт долей с нуля), 0xFB — продолжить
      running_ = true; if (status == 0xFA) ticks_ = 0;
      m.t = MidiMsg::START;
    } else if (status == 0xFC) { running_ = false; m.t = MidiMsg::STOP; }
    return m;
  }

 private:
  static constexpr int KEEP = 97;       // тиков в кольце: 4 доли × 24 + 1 — темп по 96 интервалам
  double tickAt_[KEEP] = {};            // времена прихода тиков, кольцо
  int first_ = 0, kept_ = 0;            // где самый старый и сколько хранится
  long ticks_ = 0;                      // тиков с пуска (0xFA)
  bool running_ = false;
};

class Follower {
 public:
  enum Ev { NONE = 0, START = 1, STOP = 2, TEMPO = 3, BEAT = 4, LAUNCH = 5 };   // LAUNCH — первая доля после пуска: пора запускать миры
  // сообщение m пришло в момент at, сейчас now; пишет события в ev (до 2), темп — в *bpm; возвращает число событий
  int message(const MidiMsg& m, double at, double now, int* ev, double* bpm) {
    int k = 0;
    if (grid_.on && now < lastBeatAt_ - 0.05) grid_.on = false;   // время пошло назад — сетка старых часов не годится
    *bpm = m.bpm;
    if (m.t == MidiMsg::START) { waitFirst_ = true; halted_ = false; grid_.on = false; ev[k++] = START; }
    else if (m.t == MidiMsg::STOP) { grid_.on = false; waitFirst_ = false; halted_ = true; ev[k++] = STOP; }
    else if (m.t == MidiMsg::TEMPO) { ev[k++] = TEMPO; }
    else if (m.t == MidiMsg::BEAT && !halted_ && (m.bpm > 0 || (grid_.on && !waitFirst_))) {   // первая доля без темпа сетку не строит
      if (waitFirst_) grid_.on = false;                 // после пуска сетка — с нуля
      next(m.n, at, m.bpm);
      ev[k++] = BEAT;
      if (waitFirst_) { waitFirst_ = false; ev[k++] = LAUNCH; }
    }
    return k;
  }
  void tick(double now) {                               // раз в блок: время пошло назад или часы пропали — сетки нет
    if (grid_.on && (now < lastBeatAt_ - 0.05 || now > lastBeatAt_ + MIDI_LOST)) grid_.on = false;
  }
  const Grid& grid() const { return grid_; }

 private:
  void next(double n, double at, double bpm) {          // nextBeat: доля n пришла в at
    if (!grid_.on) {                                    // сетки нет — строим по темпу этой доли
      grid_.on = true; grid_.p = 60 / bpm; grid_.t0 = at - n * grid_.p; lastBeatAt_ = at; lastBeat_ = n; kept_ = 0; hadOutlier_ = false;
      return;
    }
    const bool wasOutlier = hadOutlier_;                // выброс помнится ровно одну долю
    hadOutlier_ = false;
    if (n > lastBeat_) {
      const double iv = (at - lastBeatAt_) / (n - lastBeat_);
      if (iv >= 0.5 * grid_.p && iv <= 2 * grid_.p) push(iv);   // правдоподобный интервал
      else if (wasOutlier && std::fabs(iv - outlier_) < 0.1 * iv) { kept_ = 0; push(outlier_); push(iv); }   // два согласных выброса — новый темп
      else { hadOutlier_ = true; outlier_ = iv; }
    }
    double p = grid_.p;
    if (kept_) { double s = 0; for (int i = 0; i < kept_; i++) s += intervals_[i]; p = s / kept_; }
    const double e = at - (grid_.t0 + n * grid_.p);     // насколько доля разошлась с сеткой
    const double target = std::fabs(e) > MIDI_JUMP ? at : at - e / 2;   // большая ошибка — прыжок, малая — полпути
    grid_.t0 = target - n * p; grid_.p = p; lastBeatAt_ = at; lastBeat_ = n;
  }
  void push(double iv) {
    if (kept_ == 4) { for (int i = 0; i < 3; i++) intervals_[i] = intervals_[i + 1]; kept_ = 3; }   // не больше 4: старый уходит
    intervals_[kept_++] = iv;
  }
  Grid grid_;
  double lastBeatAt_ = 0, lastBeat_ = 0;                // когда пришла прошлая доля и её номер
  double intervals_[5] = {};                            // последние интервалы между долями (с), в ходу до 4
  double outlier_ = 0;                                  // прошлый выброс (с)
  int kept_ = 0;                                        // сколько интервалов в intervals_
  bool hadOutlier_ = false, waitFirst_ = false, halted_ = false;   // прошлая доля — выброс; пуск ждёт первую долю; стоп
};

// Когда играть шаг со временем t в блоке, который начинается в now: в будущем (или в этом блоке) — как есть; первый после пуска,
// чуть опоздавший, — сейчас; иначе пропустить (−1). В JS (host/midi.js due) шаги ставились на 200 мс вперёд по таймеру и порог был
// now + 3 мс; здесь шаг ставит сам блок, поэтому «в будущем» — с начала блока.
inline double dueAt(double t, double now, bool first) {
  if (t >= now) return t;
  if (first && now - t < LATE_FIRST) return now;
  return -1;
}

// Шагомер. run(now, end, grid, perBeat, dur, swing, fire) — раз в блок [now, end): ставит все шаги, что начинаются до end.
//   dur(step)   — длина шага своим темпом (с), зовётся без сетки;
//   swing(step) — сдвиг шага от сетки (с), зовётся с сеткой;
//   fire(step, t) — шаг step прозвучит в t (t ≥ now): мир переводит t в сэмпл блока.
// Сменили perBeat при сетке — номер шага пересчитывается, чтобы остаться на том же месте доли. Порядок и правила — autoSchedule
// прежнего engine.js. reset() — с нуля: следующий run начнёт с шага 0 в now.
class Steps {
 public:
  void reset() { nextAt_ = 0; step_ = 0; firedAt_ = -1; perBeat_ = 0; armed_ = false; }
  long step() const { return step_; }                   // номер следующего шага
  double next() const { return nextAt_; }               // когда следующий шаг (с, без swing)
  template <class Dur, class Swing, class Fire>
  void run(double now, double end, const Grid& grid, int perBeat, Dur dur, Swing swing, Fire fire) {
    const bool g = grid.on && grid.p > 0;               // сетка с p ≤ 0 — не сетка
    if (!armed_) { nextAt_ = now; armed_ = true; }
    if (perBeat_ && perBeat != perBeat_ && g) step_ = static_cast<long>(std::ceil(static_cast<double>(step_) * perBeat / perBeat_));
    perBeat_ = perBeat;
    const auto align = [&]() {                          // с сеткой: не отставать от неё больше чем на шаг, время — с сетки
      if (!g) return;
      const long k = static_cast<long>(std::floor(((now - grid.t0) / grid.p) * perBeat)) - 1;
      if (k > step_) step_ = k;
      nextAt_ = stepTime(grid, static_cast<double>(step_), perBeat);
    };
    align();
    for (int guard = 0; nextAt_ < end && guard < 4096; guard++) {   // guard — от вечного цикла при dur ≤ 0
      const double t = dueAt(g ? nextAt_ + swing(step_) : nextAt_, now, step_ == 0);
      if (t >= 0 && t > firedAt_) { firedAt_ = t; fire(step_, t); }   // не раньше прошлого: swing не переставит шаги местами
      if (!g) nextAt_ += dur(step_);
      step_++;
      align();
    }
  }

 private:
  double nextAt_ = 0;                                   // время следующего шага (с)
  double firedAt_ = -1;                                 // когда прозвучал прошлый шаг (с)
  long step_ = 0;
  int perBeat_ = 0;                                     // деление доли в прошлом run; 0 — ещё не было
  bool armed_ = false;                                  // после reset ещё не было run
};

}  // namespace sdk
