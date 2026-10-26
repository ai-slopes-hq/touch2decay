// Tenebrae (мир I) — мир SDK, этап 1: только звук. Модель, жесты, снимок и рисование — в app.js; модель шлёт поля голоса, связи,
// LFO и FX действиями, формулы звука (частота по ладу, cutoff, сдвиг) ядро считает само. Эталон — worlds/tenebrae/engine.js (узлы Web Audio).
// Схема: 6 голосов (voice.hpp) → шина × 1/√max(1, Σ env) (τ 0.3, пересчёт раз в блок) → pre → asym(2.4, 0.35) os 4× → post → выход;
// эхо: post × dly·0.7 → пинг-понг 0.37 / 0.53 с (LP 2600 / 2100, fb 0.46, wow 0.13 Гц ±4 мс и 0.087 Гц ±5 мс) → выход;
// посыл в общий зал (hall): (post + эхо) × rev²·1.4. Связи — у приёмника, сигнал m источника × глубина (Param, как GainNode связи).
// Удар по солнцу — шум в полосе двумя щелчками и глухой толчок 140 → 45 Гц, в шину. Шум bp/hiss — один на все голоса (ModIn.noise).
// Случайность — sdk::Rng от зерна мира (seed ^ 0x54454e). Ничего не звучит и хвост дозвучал — блок не считается (нули).
//
// action(kind, i, a, n) (те же числа — ACT в worlds/tenebrae/engine.js; kind −1 — тик хоста, пропустить):
//   VOICE i, a = [x, y, cut, res, wave, beat (Гц), fm, shift, amp, holeT, snap]  — поля голоса (apply); snap — все τ 0.004
//   ON i;  OFF i, a = [τ];  LIVE i, a = [0 | 1]  — подключить / отцепить (отцеплённый не считается)
//   LINKS i, a = [src, type, depth] × k  — все связи приёмника i (type: 0 fm, 1 tzfm, 2 am, 3 rm); пусто — снять все
//   LFO i, a = [key, morph, rate, depth]  — key: 0 pitch, 1 wave, 2 cut, 3 res, 4 beat, 5 shift, 6 amp, 7 fm; depth 0 — снять
//   FX a = [rev, dly, dirt];  STRIKE a = [p];  CLEAR  — звучащие гаснут τ 0.25, связи сняты (LFO снимает модель, как в вебе)
// Зеркало: [6, затем на голос: live, env, 128 точек контура] — MIRROR_N = 781; у неживого голоса точки — нули;
// ни одного живого — только заголовок [6] (MIRROR_HEAD): клей читает это как «контуров нет».
// Лад хоста (const Scale&) сверяется в начале action и process: сменился — apply всех голосов заново (частоты, глубины tzfm).
#pragma once
#include <string>
#include "../../host/scale.hpp"
#include "../../sdk/biquad.hpp"
#include "../../sdk/osc.hpp"
#include "../../sdk/param.hpp"
#include "../../sdk/pingpong.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/shaper.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "voice.hpp"
#include "waves.hpp"

namespace tenebrae {

enum Act { VOICE = 0, ON = 1, OFF = 2, LIVE = 3, LINKS = 4, LFO = 5, FX = 6, STRIKE = 7, CLEAR = 8 };
enum LinkType { FM = 0, TZFM = 1, AM = 2, RM = 3 };
constexpr int VOICES = 6, NFIELD = 11;
constexpr int MIRROR_HEAD = 1, MIRROR_V = 130, MIRROR_N = MIRROR_HEAD + VOICES * MIRROR_V;   // [6, затем × голос: live, env, 128 точек]

class World : public sdk::World {
 public:
  static constexpr int MAXLINK = 24;                    // связей у приёмника: 5 источников × 4 типа с запасом
  static constexpr int ECHO_MAX = 1 << 16;              // линия эха: 0.53 с + квант + 0.005 с до 96 кГц (DelayNode(2) — с запасом)
  static constexpr int NSTRIKE = 4;                     // ударов одновременно (новый вытесняет самый старый)

  explicit World(const Scale& scale) : sc_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }   // как send('hall') у мира 1 в app.js
  int mirror(double* buf, int cap) const override;
  int heard(double*, int) override { return 0; }
  std::string snapshot() const override { return ""; }  // снимок и undo — у JS (этап 1)
  void restore(const std::string&) override {}
  bool sounding() const override;

  // для тестов
  double busGain() const { return bus_.y; }
  int links(int i) const { return nl_[i]; }
  double linkValue(int i, int k) const { return L_[i][k].g.value(); }   // глубина связи k приёмника i в единицах цели (ц, Гц, доли vca)
  const Voice& voice(int i) const { return v_[i]; }

 private:
  struct Link {
    int src = 0, type = 0;
    double depth = 0;
    sdk::Param g;                                       // как GainNode связи: от 0, к глубине с τ apply
    double b[128];
  };
  struct Strike {
    bool on = false;
    double t0 = 0, nEnd = 0, oEnd = 0;                  // сэмплы мира: начало, конец шума, конец толчка
    sdk::Biquad bp;
    sdk::Param ng, og, of;                              // громкость треска, громкость и частота толчка
    sdk::Osc o;
  };
  void applyVoice(int i, bool snap);                    // apply(i, snap): поля голоса, база vca, глубины связей
  void retune();                                        // лад хоста сменился с прошлой сверки — заново apply у всех голосов с полями
  double depthOf(const Link& l) const;                  // linkDepth: глубина в единицах цели
  void setLinks(int i, const double* a, int n);
  void strike(double p);
  double strikeStep(double t);

  const Scale& sc_;
  Scale scApplied_;                                     // лад, с которым считали частоты (сверка в начале process)
  Tables T_;
  bool built_ = false;
  Voice v_[VOICES];
  double a_[VOICES][NFIELD] = {};
  bool has_[VOICES] = {};                               // поля голоса присылали (в вебе F[i] ≠ null)
  double rm_[VOICES] = {};                              // Σ rm приёмника на последнем apply
  Link L_[VOICES][MAXLINK];
  int nl_[VOICES] = {};
  sdk::Rng nz_{1}, rs_{2};                              // общий шум голосов; удары (полоса, щелчок, шум)
  sdk::Glide bus_, pre_, post_, dly_, rev_;
  sdk::Shaper2<4096> drv_;                              // L и R — одна кривая, ступени oversample парой
  sdk::PingPong<ECHO_MAX> echo_;
  sdk::Osc wowL_, wowR_;
  Strike st_[NSTRIKE];
  double sr_ = 48000, now_ = 0;                         // now_ — сэмплов с prepare (начало следующего блока)
  long quiet_ = 0;                                      // сэмплов тишины без живых голосов и ударов
};

}  // namespace tenebrae
