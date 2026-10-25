// Portus — мир SDK (этап 1: звук и часы; модель пока в вебе — model.js шлёт ядру состояние целиком, как Cymatica на этапе 1).
// Звук — как worlds/portus/engine.js до SDK: стабы (пары band-limited пил на ноту аккорда → два lowpass 24 дБ с огибающей → vca → панорама),
// шина stabs → drive (tanh) → post → ×0.85 сухо; эхо пинг-понг (HP 240, LP по темноте, насыщение на одной ноге, wow на времени, «лента» —
// время скользит τ 0.08 с); туман — посыл в общий ревербер хоста (room / hall / cathedral по размеру, смена — сначала гаснет, потом растёт);
// море — шум в полосе под медленной волной. Часы — sdk::Steps по часам хоста (свой темп или сетка MIDI-часов), шаг → стаб с точностью до
// сэмпла; chance — от зерна мира. Эхо — одна пара линий от моно-суммы (в браузере сеть шла по каналам: на линейном пути то же, различие — только
// в насыщении, и оно невелико). Чего нет: часов наружу (pulse для ведущего MIDI — решение 23.10: t2d ведомый).
//
// action(kind, i, a, n):
//   STATE a = [bpm, chance, swing, chord, lvl, len, fc, res, env, dt, tone, mix, fb, fog, size, drive, wow, mare, spread, 16 × (on, hz, p, lvl)]
//     (fc — срез в Гц, dt — время эха в шестнадцатых, fb — обратная связь 0…0.985, hz — тоника кораблика с ладом и октавами, p — нота поперёк 0…12)
//   PLAY a = [on];  KILL;  AUDITION a = [hz, p, lvl]
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

namespace portus {

enum Act { STATE, PLAY, KILL, AUDITION };
constexpr int NSTEP = 16, VOICES = 8, MAXIV = 6, MAXOSC = 2 * MAXIV;
enum St { S_BPM, S_CHANCE, S_SWING, S_CHORD, S_LVL, S_LEN, S_FC, S_RES, S_ENV, S_DT, S_TONE, S_MIX, S_FB, S_FOG, S_SIZE, S_DRIVE, S_WOW, S_MARE, S_SPREAD, S_HEAD };
constexpr int STATE_N = S_HEAD + NSTEP * 4;
constexpr int ECHO_MAX = 100000;                       // линия эха: 2.08 с при 48 кГц — до 8 шестнадцатых на 60 BPM; на 96 кГц время упрётся в потолок
constexpr int MIRROR_N = 3;                            // шаг (или −1), играет, живых голосов
constexpr double PSPAN = 12;

class World : public sdk::World {
 public:
  explicit World(const Scale&) {}
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return rev_; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;             // записи по 2: [1, шаг] на каждый прозвучавший удар
  std::string snapshot() const override { return "{}"; }   // этап 1: снимок — в model.js
  void restore(const std::string&) override {}
  bool sounding() const override;
  void attach(const sdk::Clock* c) override { clk_ = c; }

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
  void applyState();
  void stab(double t, double hz, double p, double lvl, double vel, double gap, int step);
  void voiceCoefs(Voice& v, double tr);
  double stepSec() const { return 60.0 / bpm_ / 4; }
  double swingAt(long k) const { return (k % 2) ? swing_ * stepSec() * 0.5 : 0; }
  double gapFrom(int j) const;

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
  struct Slot { bool on = false; double hz = 0, p = 0, lvl = 1; } slots_[NSTEP];
  double sr_ = 48000, now_ = 0, bpm_ = 120, swing_ = 0, killUntil_ = -1, driveK_ = -1;
  bool playing_ = false, got_ = false, killed_ = false, seaOn_ = false;
  int cur_ = -1, nHeard_ = 0, heardSteps_[32];
  struct Pend { double t; int step; };
  Pend pend_[16];
  int npend_ = 0;
};

}  // namespace portus
