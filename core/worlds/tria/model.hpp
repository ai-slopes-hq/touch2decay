// Tria corpora — модель в ядре: порт tools/ref/tria-model.js (worlds/tria/model.js до SDK D4) без картинки — следы, кубик (rng) и время
// вспышек для рисования живут в фасаде веба. Три тела на блюде: тяга, leapfrog 8…64 подшага, край, энергия (keepEnergy, EMIN, fresh),
// cadit, Fiat lux, аспекты (колокол при пересечении круга / луча), край (тимпан), соединения, дрон пары (pairK, trem, amp, hz), лад хоста.
// Шаг — step(dt) раз в блок (dt = n/sr): при тех же dt траектория та же, что у эталона (числа в том же порядке, Math.hypot — jsHypot).
// Что прозвучать — события шага (ev()), вспышки — flashes() (очищаются в начале шага).
#pragma once
#include <string>
#include "../../host/scale.hpp"

namespace tria {

constexpr int NB = 3;
constexpr double EPS = 0.1, KC = 0.35, EMIN = 0.6;
enum Fx { GRAVITAS, FLUX, NEXUS, ASPECTUS, DECAY, HALL, NFX };   // порядок — FX_DEF в model.js
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Body {
  double x = 0, y = 0, vx = 0, vy = 0, m = 1, semi = 0, level = 0.8, amp = 0, hz = 110;
  bool fixed = false, held = false;
};

struct Ev {                                             // событие звука: колокол, тимпан, шорох, пуск генераторов, fx
  enum Type { BELL, THUD, BURST, START, FXCH } t;
  int i = 0;
  double f = 0, vel = 0, pan = 0, k = 0;               // bell: i, f, vel, pan; thud: i, vel = vn; burst: f, pan, k
};

struct Flash { int i; int kind; double x, y, q; };     // kind: 0 ring, 1 ray, 2 rim, 3 conj

class Model {
 public:
  static constexpr int EVMAX = 32, FLMAX = 16;
  explicit Model(const Scale& scale) : scale_(scale) { reset(); }
  void reset();                                         // как createModel: тела в покое, fx по умолчанию

  void step(double dt);                                 // tick без следов: время, физика, голос
  // действия (как у model.js)
  void fiatLux();
  void plumb();
  void anchor(int i);
  void grab(int i);
  void drop(int i);
  void drag(int i, double x, double y);
  void release(int i, bool thrown, double vx, double vy);
  void setBody(int i, int key, double v);              // key: 0 m, 1 semi, 2 fixed, 3 level (v — 0…1, как плашка)
  void setFx(int k, double v);
  void dice(const double* a);                           // кубик фасада: 3 × (x, y, vx, vy, m, semi)
  void clear();
  std::string snapshot() const;
  bool restore(const std::string& js);

  double hzOf(const Body& b) const;
  double baseHz(const Body& b) const;
  double energy() const;                                // K + U
  double Gc() const { return 0.25 + 0.75 * fx_[GRAVITAS]; }

  const Body& body(int i) const { return b_[i]; }
  double fx(int k) const { return fx_[k]; }
  bool still() const { return still_; }
  bool lux() const { return lux_; }
  bool cadit() const { return cadit_; }
  double time() const { return time_; }
  double pairK(int i) const { return pairK_[i]; }
  double trem(int i) const { return trem_[i]; }
  int nev() const { return nev_; }
  const Ev& ev(int k) const { return ev_[k]; }
  int nflash() const { return nfl_; }
  const Flash& flash(int k) const { return fl_[k]; }
  void clearEvents() { nev_ = 0; nfl_ = 0; }

 private:
  void accel(int i, double& ax, double& ay) const;
  void energyKU(double& K, double& U) const;
  void keepEnergy(double dt);
  void physics(double dt);
  void aspects(double now);
  void voice(double dt, double now);
  double snap(double s) const;
  double tonic() const { return scale_.on ? scale_.root : 0; }
  int rays() const { return fx_[ASPECTUS] < 0.34 ? 0 : fx_[ASPECTUS] < 0.67 ? 4 : 8; }
  void start() { emit({Ev::START}); }
  void emit(const Ev& e) { if (nev_ < EVMAX) ev_[nev_++] = e; }
  void flash(int i, int kind, double x, double y, double q = 0) { if (nfl_ < FLMAX) fl_[nfl_++] = {i, kind, x, y, q}; }

  const Scale& scale_;
  Body b_[NB];
  double fx_[NFX] = {};
  bool still_ = true, lux_ = false, cadit_ = false;
  double time_ = 0;
  double pairK_[NB] = {}, trem_[NB] = {};
  // энергия: E0 — энергия броска; ключ — то, от чего она зависит (gravitas, lux, массы, якоря, удержание)
  bool hasE0_ = false, eDirty_ = true, fresh_ = true;
  double E0_ = 0;
  struct Key { double g = -1; bool lux = false; double m[NB] = {}; bool fixed[NB] = {}, held[NB] = {}; bool operator==(const Key& o) const; };
  Key eKey_;
  double rims_[NB] = {};
  bool hasPrev_[NB] = {};
  double prevR_[NB] = {}, prevA_[NB] = {}, lastHit_[NB] = {}, conjAt_[NB] = {};
  bool near_[NB] = {};
  Ev ev_[EVMAX];
  int nev_ = 0;
  Flash fl_[FLMAX];
  int nfl_ = 0;
};

}  // namespace tria
