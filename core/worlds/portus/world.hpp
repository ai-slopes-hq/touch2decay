// Portus — мир SDK (этап 2: модель, звук и часы в ядре; в вебе — фасад worlds/portus/model.js, картинка и касания).
// Модель (model.hpp): кораблики, луна, эхо, буй, туман, маяк, FX, темп; мир читает её и ставит звук. Звук — как worlds/portus/engine.js до SDK:
// стабы (пары band-limited пил на ноту аккорда → два lowpass 24 дБ → vca → панорама), шина stabs → drive (tanh) → post → ×0.85 сухо;
// эхо пинг-понг (HP 240, LP по темноте, насыщение на одной ноге, wow на времени, «лента» — время скользит τ 0.08 с); туман — посыл в общий
// ревербер хоста (room / hall / cathedral по размеру, смена — сначала гаснет, потом растёт); море — шум в полосе под медленной волной.
// Часы — sdk::Steps по часам хоста (свой темп или сетка MIDI-часов), шаг → стаб с точностью до сэмпла; chance — от зерна мира; высота места —
// из модели в момент удара (лад хоста можно сменить на ходу). Эхо — одна пара линий от моно-суммы. Чего нет: часов наружу (pulse для
// ведущего MIDI — решение 23.10: t2d ведомый).
//
// action(kind, i, a, n):
//   PLACE i = место, a = [нота p, зерно качания];  SINK i;  MOVE i = откуда, a = [куда];  NOTE i, a = [p];  ISLE i, a = [ключ (0 oct, 1 lvl), v]
//   LUNA i = ключ (cut, res, env), a = [v];  BUOY a = [u, d];  ECHO i = ключ (time, tone, mix, fb), a = [v];  FOG i = ключ (amt, size), a = [v]
//   PHAROS i = ключ (chord, oct, len, lvl, swing), a = [v];  BPM a = [bpm];  FX i = ключ (wow, mare, drive, spread, chance), a = [v];  CLEAR
//   PLAY a = [on];  KILL;  AUDITION i = место
// Зеркало: [шаг (−1 — стоит), играет, голосов, bpm, luna×3, echo×3 (time, tone, mix), buoy u, d, fog×2, pharos×5, fx×5, затем на каждое из 16 мест:
//   занято, p, oct, lvl, sd]
#pragma once
#include <cmath>
#include "../../host/scale.hpp"
#include "../../sdk/biquad.hpp"
#include "../../sdk/pan.hpp"
#include "../../sdk/pingpong.hpp"
#include "../../sdk/rng.hpp"
#include "../../sdk/osc.hpp"
#include "../../sdk/saw.hpp"
#include "../../sdk/shaper.hpp"
#include "../../sdk/transport.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"

namespace portus {

enum Act { PLACE, SINK, MOVE, NOTE, ISLE, LUNA, BUOY, ECHO, FOG, PHAROS, BPM, FX, CLEAR, PLAY, KILL, AUDITION };
constexpr int VOICES = 8, MAXIV = 6, MAXOSC = 2 * MAXIV;
// параметры шины, которые мир собирает из модели (порядок — как у stateArgs этапа 1)
enum St { S_BPM, S_CHANCE, S_SWING, S_CHORD, S_LVL, S_LEN, S_FC, S_RES, S_ENV, S_DT, S_TONE, S_MIX, S_FB, S_FOG, S_SIZE, S_DRIVE, S_WOW, S_MARE, S_SPREAD, S_HEAD };
constexpr int ECHO_MAX = 100000;                       // линия эха: 2.08 с при 48 кГц — до 8 шестнадцатых на 60 BPM; на 96 кГц время упрётся в потолок
constexpr int MIRROR_HEAD = 24, MIRROR_ISLE = 5, MIRROR_N = MIRROR_HEAD + NSTEP * MIRROR_ISLE;

class World : public sdk::World {
 public:
  explicit World(const Scale& scale) : model_(scale) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return rev_; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;             // записи по 2: [1, шаг] на каждый прозвучавший удар
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); pull(); applyState(); }
  bool sounding() const override;
  void attach(const sdk::Clock* c) override { clk_ = c; }
  const Model& model() const { return model_; }

 private:
  struct Glide {                                        // setTargetAtTime: y идёт к to по экспоненте с τ
    double y = 0, to = 0, c = 0;
    void set(double v, double tau, double sr) { to = v; c = 1 - std::exp(-1 / (tau * sr)); }
    void jump(double v) { y = to = v; }
    double step() { y += (to - y) * c; return y; }
  };
  struct Voice {
    bool on = false, started = false;
    double ts = 0;                                      // когда начать (время хоста, с)
    int step = -1, nosc = 0;
    sdk::Saw saw[MAXOSC];
    double dt[MAXOSC] = {};
    sdk::Biquad lp1, lp2;
    double amp = 0, A = 0.004, tau = 0.1, tauF = 0.05, fc = 1000, peak = 1000, q = 0.7, e0 = -1, life = 0, pl = 0.7071, pr = 0.7071;
    long n = 0;                                         // сэмплов с начала
  };
  void pull();                                          // параметры шины из модели
  void applyState();
  void stab(double t, int j, double vel, double gap);
  void voiceCoefs(Voice& v, double tr);
  double stepSec() const { return 60.0 / bpm_ / 4; }
  double swingAt(long k) const { return (k % 2) ? swing_ * stepSec() * 0.5 : 0; }
  double gapFrom(int j) const;

  Model model_;
  const sdk::Clock* clk_ = nullptr;
  sdk::Rng rng_{1};
  sdk::Steps steps_;
  sdk::PingPong<ECHO_MAX> echo_;
  sdk::Shaper<1024> drive_, sat_;
  Voice voices_[VOICES];
  sdk::Biquad bp_, lpSea_;
  sdk::Osc wow_, swell_;
  Glide gPost_, gSend_, gWet_, gFb_, gTime_, gWow_, gRSend_, gRev_, gMare_, gLpL_, gLpR_;
  sdk::Rev rev_ = sdk::Rev::hall, wantRev_ = sdk::Rev::hall;
  double st_[S_HEAD] = {};
  double sr_ = 48000, now_ = 0, bpm_ = 120, swing_ = 0, killUntil_ = -1, driveK_ = -1;
  bool playing_ = false, got_ = false, killed_ = false, seaOn_ = false;
  int cur_ = -1, nHeard_ = 0, heardSteps_[32];
  struct Pend { double t; int step; };
  Pend pend_[16];
  int npend_ = 0;
};

}  // namespace portus
