// Goetia — модель в ядре: восемь знаков круга, печать (путь от знака к знаку) → программа bytebeat, духи в треугольниках (до трёх),
// общие FX. Порт tools/ref/goetia-model.js (worlds/goetia/model.js до SDK B) один в один, тот же порядок вызовов rng; лад — у хоста.
// Своего времени у модели нет. Что должно прозвучать — события слушателю: дух целиком (печать, высота, тон…), fx.
// Имя духа (numOf, SPIRITS) и формула — только картинка, они в JS. id духа — born (порядок призыва, растёт строго).
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"
#include "../../host/scale.hpp"

namespace goetia {

constexpr int SMAX = 3, SEAL_MAX = 8;
enum Fx { LEGIO, ECHO, SPREAD, HALL, NFX };            // порядок — FX_DEF в model.js
enum Key { SEMI, TONE, REL, LEGIO_N, LVL, NKEY };      // что духа правит set
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];
extern const int NODE_OP[8], NODE_SH[8];               // узлы круга: код знака (Op из goetia.hpp) и сдвиг

struct Spirit {
  int slot = 0, born = 0;
  int path[SEAL_MAX] = {}, np = 0;                      // узлы печати по порядку
  double semi = 0, tone = 0.45, rel = 1;
  int legio = 1;
  double lvl = 0.8;
};

struct Ev {
  enum Type { SPIRIT, FX } t;
  const Spirit* s;                                      // для FX — nullptr
  bool on, added;
};

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) {}
  void reset(uint32_t seed);
  void listen(void (*fn)(void*, const Ev&), void* ctx) { emit_ = fn; ctx_ = ctx; }

  double semi(const Spirit& s) const;                   // с ладом — ступень (snap(semi + 24) − 24)
  double rate(const Spirit& s) const;                   // 128·55·2^(semi/12) отсчётов t в секунду
  static int trig(const Spirit& s);                     // удар — по самому медленному члену, не чаще бита IX
  static double fc(const Spirit& s);                    // tone → срез lowpass, Гц

  // дух в свободный треугольник (slot от UI, если свободен); все заняты — уходит самый старый.
  // born от UI: > 0 и не живой — как есть, иначе свой (на 1 больше всех виденных)
  Spirit* summon(const int* path, int np, double semi, double tone, double rel, int legio, double lvl, int slot = -1, int born = 0);
  void banish(int born);
  void setPath(int born, const int* path, int np);
  void set(int born, int key, double v);
  void setFx(int k, double v);
  void clear();
  void dice();

  std::string snapshot() const;                         // тот же JSON, что у model.js: {s: [{slot,path,semi,tone,rel,legio,lvl}], fx}
  void restore(const std::string& js);                  // у духа может быть ещё born — как у summon (так шлёт фасад); slot — как у summon

  int count() const { return n_; }
  const Spirit& spirit(int i) const { return ss_[i]; }
  Spirit* find(int born);
  double fx(int k) const { return fx_[k]; }

 private:
  void emit(Ev::Type t, const Spirit* s, bool on = true, bool added = false) { if (emit_) emit_(ctx_, Ev{t, s, on, added}); }
  void banishAt(int i);
  int randPath(int* p);

  const Scale& scale_;
  sdk::Rng rng_{1};
  Spirit ss_[SMAX];                                     // по порядку призыва, как массив в JS
  int n_ = 0, bornSeq_ = 0;
  double fx_[NFX] = {};
  void (*emit_)(void*, const Ev&) = nullptr;
  void* ctx_ = nullptr;
};

}  // namespace goetia
