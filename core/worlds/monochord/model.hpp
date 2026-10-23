// Monochordum — модель в ядре: четыре струны с подставками, ветер, автострам Земли. Порт tools/ref/monochord-model.js
// (worlds/monochord/model.js до SDK D1) один в один, тот же порядок вызовов rng; лад и тоника — у хоста. Своего времени у модели нет:
// шаги автострама ставит мир (sdk::Steps), модель говорит, что играет шаг (autoStep) и сколько он длится (stepDur, swingAt).
// Что должно прозвучать — события слушателю: tune (высота и тембр струны), pluck, harm, bow, sus, wind, auto, fx.
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"
#include "../../host/scale.hpp"

namespace monochord {

constexpr int N = 4, NMARKS = 14;
extern const double F_OPEN[N];                          // открытые струны: A1, E2, A2, E3
extern const double MARKS[NMARKS];                      // пифагоровы лады (доля звучащей длины) — сферы Фладда
extern const int DIVS[4];                               // шагов на долю: 1/4, 1/8, 1/8T, 1/16
enum Fx { DECAY, BRIGHT, BODY, SYMPATHY, CHORUS, CHANCE, HALL, NFX };   // порядок — FX_DEF в model.js
enum Key { PITCH, KBRIGHT, KDECAY, LEVEL, R, NKEY };   // плашка струны (pitch — r без прилипания); R — r как есть (кубик фасада)
enum AutoKey { ON, BPM, DIV, PATTERN, STRENGTH, SWING, NAUTO };
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Str { double r = 1; bool sus = false; double bright = 0.55, decay = 0.55, level = 0.8, bow = 0; };
struct Hit { int i; double pos, vel, dt; };            // щипок шага: струна, место, сила, сдвиг от начала шага (с)

struct Ev {
  enum Type { TUNE, PLUCK, HARM, BOW, SUS, WIND, AUTO, FX } t;
  int i;
  double a, b;                                          // PLUCK: pos, vel; HARM: n, vel; BOW: amp; SUS / AUTO: on; WIND: amt
};

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(1); }
  void reset(uint32_t seed);
  void listen(void (*fn)(void*, const Ev&), void* ctx) { emit_ = fn; ctx_ = ctx; }

  double hzOf(int i) const;
  double snapR(double r) const;

  void pluck(int i, double pos, double vel) { emit(Ev::PLUCK, i, pos, vel); }
  void harm(int i, int n, double vel) { emit(Ev::HARM, i, n, vel); }
  void bow(int i, double amp);
  void setSus(int i, bool on);
  void setBridge(int i, double r);
  void setString(int i, int key, double v);
  void setWind(double v);
  void setFx(int k, double v);
  void setAuto(bool on);
  void setAutoPar(int k, double v);                     // bpm, div, pattern, strength, swing — читаются на каждом шаге
  void clear();

  double stepSec() const { return 60 / auto_[BPM] / DIVS[div()]; }
  double stepDur(long step) const;
  double swingAt(long step) const;
  int perBeat() const { return DIVS[div()]; }
  int autoStep(long step, Hit* out);                    // щипков в шаге (до 4; у random бывает 0 — Земля всё равно вспыхивает); −1 — шаг пропущен (chance)

  std::string snapshot() const;                         // тот же JSON, что у model.js: {str: [{r, sus, bright, decay, level}], fx, wind, auto}
  void restore(const std::string& js);
  bool sounding() const;

  const Str& str(int i) const { return s_[i]; }
  double fx(int k) const { return fx_[k]; }
  double wind() const { return wind_; }
  double lastWind() const { return lastWind_; }
  double autoPar(int k) const { return auto_[k]; }
  bool autoOn() const { return auto_[ON] != 0; }

 private:
  int div() const { int d = static_cast<int>(auto_[DIV]); return d < 0 ? 0 : d > 3 ? 3 : d; }
  void emit(Ev::Type t, int i = 0, double a = 0, double b = 0) { if (emit_) emit_(ctx_, Ev{t, i, a, b}); }

  const Scale& scale_;
  sdk::Rng rng_{1};
  Str s_[N];
  double fx_[NFX] = {};
  double auto_[NAUTO] = {};
  double wind_ = 0, lastWind_ = 0.5;
  void (*emit_)(void*, const Ev&) = nullptr;
  void* ctx_ = nullptr;
};

}  // namespace monochord
