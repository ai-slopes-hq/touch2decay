// Oceanus — модель в ядре: города-голоса на земле T-O, общие FX, луна (LFO мира). Порт tools/ref/oceanus-model.js
// (worlds/oceanus/model.js до SDK B) один в один, тот же порядок вызовов rng; лад и тоника — у хоста (Scale).
// Своего времени у модели нет: волны и луна — в звуке (ocean.hpp). Что должно прозвучать — события слушателю: город целиком,
// fx (FX и луна), палец тянет воду (push / release), всплеск. У города есть id: по нему фасад в вебе узнаёт его в зеркале.
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"
#include "../../host/scale.hpp"

namespace oceanus {

constexpr int VMAX_M = 6, PIN_MAX = 4;                 // голосов (= VMAX звука), закреплённых городов
enum Fx { TENSION, DAMPING, WIND, TIDE, HALL, NFX };   // порядок — FX_DEF в model.js
enum Luna { ORBIT, STORM, SWAY, TO, NLUNA };           // порядок — LUNA_DEF
enum Key { LVL, OCT, PATH, PINNED, NKEY };             // что города правит set
extern const char* const FX_NAMES[NFX];
extern const char* const LUNA_NAMES[NLUNA];
extern const double FX_DEF[NFX];
extern const double LUNA_DEF[NLUNA];

struct Voice {
  int slot = 0, id = 0;
  double ang = 0, rn = 0;                               // угол по часовой от верха (рад), доля радиуса земли (0 центр … 1 берег)
  bool pinned = false;
  double lvl = 0.8;
  int oct = 0, path = 0;
};

struct Ev {
  enum Type { VOICE, FX, PUSH, RELEASE, SPLASH } t;
  const Voice* v;                                       // VOICE
  bool on, added;
  double id, a, d;                                      // PUSH (id, a, d), RELEASE (id), SPLASH (a — место, d — сила)
};

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) {}
  void reset(uint32_t seed);                            // пусто, FX и луна по умолчанию
  void listen(void (*fn)(void*, const Ev&), void* ctx) { emit_ = fn; ctx_ = ctx; }

  double semiOf(const Voice& v) const;                  // климат — октава, угол — полутоны; с ладом — ступень
  double hz(const Voice& v) const;

  // slot / id от UI: слот занят или −1 — первый свободный; id > 0 и не живой — как есть, иначе свой (на 1 больше всех виденных)
  Voice* add(double ang, double rn, bool pinned, int slot = -1, int id = 0);
  void drop(int id);
  void move(int id, double ang, double rn);
  void set(int id, int key, double v);
  void setFx(int k, double v);
  void setLuna(int k, double v);
  void push(double id, double a, double d) { emit(Ev{Ev::PUSH, nullptr, true, false, id, a, d}); }
  void release(double id) { emit(Ev{Ev::RELEASE, nullptr, false, false, id, 0, 0}); }
  void splash(double a, double amt) { emit(Ev{Ev::SPLASH, nullptr, true, false, 0, a, amt}); }
  void clear();
  void dice();

  std::string snapshot() const;                         // тот же JSON, что у model.js: {v: [{ang,rn,lvl,oct,path}] (только закреплённые), fx, luna}
  void restore(const std::string& js);                  // у города может быть ещё slot и id — как у add (так шлёт фасад)

  int count() const { return n_; }
  const Voice& voice(int i) const { return vs_[i]; }
  Voice* find(int id);
  double fx(int k) const { return fx_[k]; }
  double luna(int k) const { return luna_[k]; }

 private:
  void emit(const Ev& e) { if (emit_) emit_(ctx_, e); }
  void voiceEv(const Voice* v, bool on, bool added = false) { emit(Ev{Ev::VOICE, v, on, added, 0, 0, 0}); }
  void fxEv() { emit(Ev{Ev::FX, nullptr, true, false, 0, 0, 0}); }
  void dropAt(int i);

  const Scale& scale_;
  sdk::Rng rng_{1};
  Voice vs_[VMAX_M];                                    // по порядку добавления, как массив в JS
  int n_ = 0, serial_ = 0;
  double fx_[NFX] = {}, luna_[NLUNA] = {};
  void (*emit_)(void*, const Ev&) = nullptr;
  void* ctx_ = nullptr;
};

}  // namespace oceanus
