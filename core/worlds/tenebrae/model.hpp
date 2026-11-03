// Tenebrae (мир I) — модель в ядре: кружки (голоса), пальцы, закрепление, связи, LFO, FX, хаос, удары, снимок. Порт
// worlds/tenebrae/model.js (эталон шага Б — tools/ref/tenebrae-model.js) один в один: тот же порядок вызовов rng, те же команды
// слушателю, шаг раз в блок process. Без DOM и звука; что должно прозвучать — команды listen (коды 0–8 мира, раскладки — в world.hpp):
//   attack → LIVE [1] (если не live), ON;  release → OFF [τ];  снять LFO → LFO [key,0,0,0];  голос изменился (dirty) →
//   LINKS [src,type,depth]×k, затем по 8 ключам LFO [key,morph,rate,depth] или [key,0,0,0], затем VOICE [x,y,cut,res,wave,beat,fm,shift,amp,holeT,snap];
//   fx → FX [rev,dly,dirt];  удар → STRIKE [p];  clear → CLEAR;  смерть → LIVE [0].
// События для вида (burst, strike) копятся в очереди (до 64) и отдаются heard.
// Без аллокаций вне snapshot / restore. Случайность — только sdk::Rng от зерна seed ^ MODEL_SEED.
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"

namespace tenebrae {

constexpr int VOICES = 6;                               // 3 закреплённых + 3 временных
constexpr int PIN_MAX = 3, TEMP_MAX = 3;
constexpr double TAIL = 1.6, UNPIN_TAIL = 0.8, LINK_NEW = 0.5;
constexpr double BEAT_MIN = 0.05, BEAT_MAX = 24, BEAT_DEF = 0.35, CUT_DEF = 0.68, RES_DEF = 0.21, WAVE_DEF = 0.125, SHIFT_DEF = 0.5;
constexpr double LFO_DEF_MORPH = 0, LFO_DEF_RATE = 1.2, LFO_DEF_DEPTH = 0.35;
constexpr double LFO_RATE_MIN = 0.03, LFO_RATE_MAX = 20;
constexpr int MAXMOD = 5;                               // связей у приёмника (источников — пять других кружков)
constexpr int NLFO = 8;                                 // pitch, wave, cut, res, beat, shift, amp, fm
constexpr int NKEPT = VOICES;
constexpr int QUEUE_MAX = 64;                           // событий для вида; лишние отбрасываются
constexpr uint32_t MODEL_SEED = 0x4d4f44u;

struct Mod {
  int src = 0, type = 1;                                // type: 0 fm, 1 tzfm, 2 am, 3 rm
  double depth = 0, k = 0, until = 0;                   // k, until — только у авто-связи хаоса
  bool autoLink = false;
};
struct LfoSpec { bool on = false; double morph = 0, rate = 0, depth = 0; };

struct MVoice {
  double x = 0.35, y = 0.22, beat = BEAT_DEF, wave = WAVE_DEF, fm = 0, cut = CUT_DEF, res = RES_DEF, shift = SHIFT_DEF, amp = 1, holeT = 0;
  double sunT = 0, env = 0, envT = 0, envTau = 0.05, strikeNext = 0;
  int held = 0;
  bool pinned = false, active = false, live = false, snap = true, dirty = false;
  Mod mods[MAXMOD];
  int nmods = 0;
  LfoSpec lfo[NLFO];
  int lfoOrder[NLFO] = {};                              // ключи LFO по порядку добавления (порядок ключей снимка и кубика)
  int nlfo = 0;
};

class Model {
 public:
  using Listener = void (*)(void*, int kind, int i, const double* a, int n);
  void reset(uint32_t seed);                            // пустые голоса, FX по умолчанию, время 0
  void listen(Listener fn, void* ctx) { fn_ = fn; ctx_ = ctx; }

  int pick() const;                                     // голос под новый кружок (−1 — нет места): правило spawn эталона
  void spawn(int i, double p, double c, double holeT);  // новый кружок в голос i (выбор — pick)
  void grab(int i);
  void letGo(int i, bool fade);
  void keep(const int* ids, int n);
  void unkeep();
  void move(int i, double p, double c, double holeT);
  void set(int i, int key, double v);                   // key: 0 wave, 1 cut, 2 res, 3 beat, 4 fm, 5 shift, 6 amp
  int pin(int i);                                       // 0 — ничего, 1 — закреплён, 2 — снят, 3 — закреплённых уже три
  void remove(int i);
  void attack(int i);
  void release(int i, double tau);
  void link(int dst, int src);
  void linkDepth(int dst, int src, double depth);
  void linkType(int dst, int src, int type);
  void unlink(int dst, int src);
  void lfo(int i, int key, const double* spec);         // spec = [morph, rate, depth]; nullptr — снять
  void sun(int i, double t) { V_[i].sunT = t; }
  void fx(const double v[5]);                           // rev, decay, dly, chaos, dirt
  bool dice();
  void clear();
  void retune();
  void tick(double dt);

  std::string snapshot() const;                         // тот же JSON, что у model.js
  void restore(const std::string& js);
  int heard(double* buf, int cap);                      // [1, i] — burst, [2, i, p] — strike; очищает очередь

  const MVoice& voice(int i) const { return V_[i]; }
  double fx(int k) const { return fx_[k]; }
  double time() const { return time_; }
  int strikes() const { return strikes_; }
  int kept(int* out) const { for (int k = 0; k < nkept_; k++) out[k] = kept_[k]; return nkept_; }

 private:
  struct Ev { int t, i; double p; };
  void emit(int kind, int i, const double* a = nullptr, int n = 0) { if (fn_) fn_(ctx_, kind, i, a, n); }
  void push(int t, int i, double p = 0) { if (nq_ < QUEUE_MAX) q_[nq_++] = Ev{t, i, p}; }
  bool isKept(int i) const { for (int k = 0; k < nkept_; k++) if (kept_[k] == i) return true; return false; }
  void removeLfo(MVoice& v, int key);
  void clearLfos(MVoice& v);
  Mod* addLink(MVoice& dst, int src, double depth, int type);
  void dropLink(MVoice& dst, int k);
  void unlinkAll(MVoice& v);
  Mod* findMod(MVoice& v, int src);
  void chaos();
  void strikesStep();
  void sync(MVoice& v, int i);
  void emitFx();

  Listener fn_ = nullptr;
  void* ctx_ = nullptr;
  sdk::Rng rng_{1};
  MVoice V_[VOICES];
  double fx_[5] = {0.3, 3.5, 0.3, 0, 0.2};
  int kept_[NKEPT] = {};
  int nkept_ = 0;
  double time_ = 0, chaosAt_ = 0;
  int strikes_ = 0;
  Ev q_[QUEUE_MAX];
  int nq_ = 0;
};

}  // namespace tenebrae
