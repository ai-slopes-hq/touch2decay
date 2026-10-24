// Inferno — модель в ядре: девять кругов воронки, общие FX, иней Коцита, буря второго круга. Порт worlds/inferno/model.js (эталон —
// tools/ref/inferno-model.js): без DOM и звука; лад — у хоста (Scale), время — секунды шага (раз в блок process), случайность — Rng.
// Что должно прозвучать — события слушателю (emit), как listen у JS-модели: strike {k, vel}, burn {k}, tune {k}, color {k}, ice, fx.
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"
#include "../../host/scale.hpp"

namespace inferno {

constexpr int NC = 9, PIN_MAX = 4, NCOLOR = 5;
constexpr double SPAN = 60.0 / 9;                       // у каждого круга своя зона ~⅔ октавы: 55–1760 Гц на девять кругов
enum Fx { STRUCTURE, FIRE, SMOKE, ICE, STORM, NFX };    // порядок — FX_DEF в model.js
enum Key { POS, WIDTH, DRIVE, LEVEL, COLOR, NKEY };     // что круга правит setCirc (строки плашки)
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Circ {
  double pos = 0.5;
  bool sinner = false;
  int held = 0;
  int color = 0;
  double width = 0.5, drive = 0.15, level = 0.7, lvl = 0;
};

struct Ev { enum Type { STRIKE, BURN, TUNE, COLOR, ICE, FX } t; int k; double vel; };

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale), rng_(1) {}
  void reset(uint32_t seed);                            // круги по умолчанию, FX по умолчанию, время 0
  void listen(void (*fn)(void*, const Ev&), void* ctx) { emit_ = fn; ctx_ = ctx; }

  double semiOf(int k, double pos) const;
  double hzOf(int k) const;
  double Qof(const Circ& c) const;
  void ratios(int k, double r[3]) const;                // три полосы резонатора круга
  bool burning(int k) const { return c_[k].sinner || c_[k].held > 0; }
  bool sounding() const;

  void strike(int k, double vel);
  void setPos(int k, double pos);
  void hold(int k, int d);
  bool pin(int k, double pos);
  void setCirc(int k, int key, double v);
  void setFx(int i, double v);
  void clear();
  void dice();
  void tick(double dt);

  std::string snapshot() const;                         // {circ: [{pos, sinner, color, width, drive, level}], fx}
  void restore(const std::string& js);

  const Circ& circ(int k) const { return c_[k]; }
  double fx(int i) const { return fx_[i]; }
  double iceE() const { return iceE_; }
  double stormSemi() const { return stormSemi_; }
  double stormPh() const { return stormPh_; }
  double time() const { return time_; }

 private:
  void emit(Ev::Type t, int k = 0, double vel = 0) { if (emit_) emit_(ctx_, Ev{t, k, vel}); }
  const Scale& scale_;
  sdk::Rng rng_;
  Circ c_[NC];
  double fx_[NFX];
  double iceE_ = 0, stormSemi_ = 0, stormPh_ = 0, time_ = 0, iceSet_ = 0, stormAt_ = 0;
  void (*emit_)(void*, const Ev&) = nullptr;
  void* ctx_ = nullptr;
};

}  // namespace inferno
