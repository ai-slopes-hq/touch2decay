// Natura — мир SDK (этап 2: модель, звук и часы в ядре; в вебе — фасад worlds/natura/model.js, картинка и касания).
// Звук — как worlds/natura/engine.js до SDK: нота = волна (sine / square / triangle / saw / sharp — настоящие band-limited, wave.hpp) →
// lowpass с огибающей (срез от base к пику за attack, дальше к base с τ) → громкость AD → шина: срез дерева (highpass) → хор птиц (sdk::Chorus,
// моно) и лента-задержка (sdk::TapeEcho, время скользит τ 0.15 с) и посыл в общий ревербер хоста (hall). Кораблик на воде — непрерывный голос,
// лазер птиц, кваканье лягушки, шелест дерева. Часы — sdk::Steps по часам хоста (свой темп или сетка MIDI-часов, 4 шага на долю),
// шанс шага — sdk::Rng от зерна мира; нота, сыгранная шагом, — «услышана» (утки, лягушка, стрекозы).
//
// action(kind, i, a, n):
//   STATE a = [bpm, len, fx×9, 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)]  (−1 — общее значение / не задан) — сцена целиком
//   PLANT i = место, a = [note, wave];  REMOVE i;  MOVE i = откуда, a = [куда];  NOTE i, a = [n];  LEN a = [n];  PGLIDE i, a = [on];  PWAVE i, a = [w];
//   PCHANCE i, a = [v];  PLOCK i, a = [ключ (0 cutoff, 1 res, 2 att, 3 rel), v];  PUNLOCK i, a = [ключ, 4 — шанс снова 1];  SETFX i = ключ (reverb … chance), a = [v];
//   SETBPM a = [bpm];  SHAKEBY a = [добавка] (дерево затухает τ 1.4 с в ядре);  CLEAR
//   PLAY a = [on];  HEAR i = место (послушать кувшинку сейчас);  SHAKE a = [v] (дерево);  SKIFF a = [q, t, wave];  SKIFF_OFF;  WAVE a = [w] (кораблик);
//   CROAK a = [note];  LASER;  SCARE (кораблик в заводи: утки улетели)
// Зеркало: см. MIRROR_*: [бегунок (шагов с начала петли, −1 — стоит), играет, голосов, кораблик держится, bpm, len, дерево, fx×9, 16 × кувшинка]
// Услышано: пары [вид, место]: 1 — шаг сыгран (лягушка, стрекозы), 2 — нота ударила (утки; и от шага, и от «послушать»)
#pragma once
#include <cmath>
#include "../../host/scale.hpp"
#include "../../sdk/biquad.hpp"
#include "../../sdk/ad.hpp"
#include "../../sdk/chorus.hpp"
#include "../../sdk/echo.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/transport.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "wave.hpp"

namespace natura {

enum Act { STATE, PLAY, HEAR, SHAKE, SKIFF, SKIFF_OFF, WAVE, CROAK, LASER, SCARE,
           PLANT, REMOVE, MOVE, NOTE, LEN, PGLIDE, PWAVE, PCHANCE, PLOCK, PUNLOCK, SETFX, SETBPM, SHAKEBY, CLEAR };
constexpr int NNOTE = 32, NSKIFF = 4, NCROAK = 4, NLASER = 3;                  // голосов: ноты (самый старый уступает), кораблики, лягушки, лазеры
constexpr int ECHO_MAX = 200000;                                               // линия ленты: 4.1 с при 48 кГц (DelayNode(4)); на 96 кГц время упрётся в потолок
constexpr int MIRROR_HEAD = 16, MIRROR_PAD = 9, MIRROR_N = MIRROR_HEAD + NPAD * MIRROR_PAD;   // шапка: бегунок, играет, голосов, кораблик, bpm, len, дерево, fx×9; затем 16 × (занято, note, wave, glide, chance, cutoff, res, att, rel)

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::hall; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); applyFx(); }
  bool sounding() const override;
  void attach(const sdk::Clock* c) override { clk_ = c; }
  const Model& model() const { return model_; }

 private:
  using Glide = sdk::Glide;
  struct NoteV {
    bool on = false, started = false, played = false;
    double ts = 0;                                      // когда начать (время хоста, с)
    long n = 0, gl = 0;                                 // сэмплов с начала; длина глайда в сэмплах (0 — нет)
    Note v;
    int pad = -1;
    Wave w;
    sdk::Biquad lp;
    sdk::AD env;
    double f = 110, r = 1, base = 0, peak = 0, A = 0, tauF = 0.1, q = 1;
  };
  struct SkiffV {
    bool on = false, held = false;
    long n = 0, rel = 0;
    Wave w;
    Glide f, fc, g;
    sdk::Biquad lp;
    double q = 0.7, lvl = 0;
  };
  struct CroakV {
    bool on = false, started = false;
    double ts = 0, hz = 110;
    long n = 0;
    Wave w;
    sdk::Biquad bp;
    sdk::AD env;
  };
  struct LaserV {
    bool on = false, started = false;
    double ts = 0;
    long n = 0;
    Wave w;
    sdk::Biquad lp;
    sdk::AD env;
  };
  void applyFx();
  void shakeTo(double v);                                // дерево: срез вверх и шелест листвы
  void startNote(double t, const Note& v, int pad, bool played);
  void noteCoefs(NoteV& v, double tr);
  void laserCoefs(LaserV& v, double t);
  double nowT() const { return clk_ ? clk_->now : now_; }
  double stepSec() const { return model_.stepSec(); }

  Model model_;
  const sdk::Clock* clk_ = nullptr;
  sdk::Rng rng_{1}, nz_{2};                             // шанс шага; шелест
  sdk::Steps steps_;
  sdk::TapeEcho<ECHO_MAX> echo_;
  sdk::Chorus<2, 4096> chorus_;
  sdk::Biquad hp_, rbp_;
  Glide hpG_, rg_, rs_;                                 // срез дерева, шелест, посыл в зал
  NoteV notes_[NNOTE];
  SkiffV sk_[NSKIFF];
  CroakV cr_[NCROAK];
  LaserV ls_[NLASER];
  double sr_ = 48000, now_ = 0, phase_ = -1, lastSound_ = -1e9, shake_ = 0;
  long tick_ = 0;                                       // сэмплов с начала
  bool playing_ = false, rustle_ = false;
  struct Pend { double t; int kind, pad; };             // kind 1 — шаг сыгран, 2 — нота ударила (послушали)
  Pend pend_[32];
  int npend_ = 0, nHeard_ = 0, heardK_[64], heardP_[64];
};

}  // namespace natura
