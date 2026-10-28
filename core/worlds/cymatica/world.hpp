// Cymatica — мир SDK (слот 2): модель (model.hpp — узор, луна, запись игрой) + звук пластины и часы секвенсера (plate.hpp).
// Модель шлёт в пластину узор, высоту, ручки тела и удары (как engine.js слал в worklet до этапа 2); web-фасад (worlds/cymatica/model.js)
// шлёт ей действия касаний. Эхо и гул резонатора — пока на Web Audio в engine.js (этап 3). Сухой выход — как у старого worklet
// (×2.5 остался в engine.js, как у Firmamentum); посыл в пластинчатый ревербер — hall²·1.4·2.5 (прежний ×1.4 у GainNode и ×2.5 после
// возврата зала), с плавным ходом (tau 0.05 с, как setTargetAtTime).
#pragma once
#include "../../sdk/ad.hpp"
#include "../../sdk/osc.hpp"
#include "../../sdk/pingpong.hpp"
#include "../../sdk/smooth.hpp"
#include "../../sdk/world.hpp"
#include "model.hpp"
#include "plate.hpp"

#include <cmath>

namespace cymatica {

// action(kind, i, a, n). Уровень пластины (звук напрямую, сверка с эталоном и отладка):
//   PARAMS a = [structure, damping, brightness]
//   F0     a = [hz]
//   STRIKE a = [x, y, hz, vel, hard, rec]       — NaN в hz / vel / hard: по умолчанию (f0, 1, 0.5)
//   SEQ    a = SEQ_N чисел, см. plate.hpp
//   LOCK   a = [off, t0, p]                     — t0 во времени ядра, секунды
//   BOW    i = id, a = [on, x, y, exciter, pressure, amp]   — NaN: как было
//   FX     a = [hall]                           — посыл в зал
// Уровень модели (касания и ручки; имена — как у методов model.js), модель сама шлёт в пластину:
//   STRIKE_AT [x, y] · PLAY [on] · REC [on] · STEPREC [on, r, m] (без аргументов — переключить) · SKIP · CURSOR [i, −1 — нет] · GRID [g] (без — по кругу) · BPM [bpm]
//   LEN i = кольцо (0 ритм, 1 мелодия) [len] · CHANCE_AT i [ch] · BEAT i · NUDGE i [ci, steps] · MOVE_MARK i [x, y] · DROP_MARK i · COMB
//   TURN i = цель (0 ритм, 1 мелодия, 2 пластина) [k, исходный узор: 16 × (on, vel, chance, has) для ритма | 16 × (on, x, y)]
//   DRIFT_TOGGLE · DRIFT_SET i = ключ (DriftKey) [t] · SET_F0 [hz] · STEP_SCALE [fromSemi, steps] · SET_FX i = ключ (Fx) [t] · LOAD_FX [NFX]
//   DICE [зерно] · CLEAR · LOAD [bpm, rlen, mlen, 16 × (on, vel, chance, has), 16 × (on, x, y)]
//   HUM [on] — гул резонатора включён (по умолчанию да; сверка звука пластины с эталоном выключает: у эталона гула нет)
//   BOW_ADD [x, y] · BOW_SET i = гнездо [x, y, exciter, pressure, amp] · BOW_DROP i = гнездо — закреплённые смычки (гнездо — по порядку списка)
// Эхо (пары PingPong по доле темпа, ручки echo и time из модели) и гул резонатора (две синусоиды под огибающей AD) — тоже здесь, до этапа 3 они были
// узлами Web Audio в engine.js; сухой выход несёт их в канал, гул — ещё и в посыл plate.
enum Act { PARAMS, F0, STRIKE, SEQ, LOCK, BOW, FX, STRIKE_AT, PLAY, REC, STEPREC, SKIP, CURSOR, GRID, BPM, LEN, CHANCE_AT, BEAT, NUDGE, MOVE_MARK,
           DROP_MARK, COMB, TURN, DRIFT_TOGGLE, DRIFT_SET, SET_F0, STEP_SCALE, SET_FX, LOAD_FX, DICE, CLEAR, LOAD, BOW_ADD, BOW_SET, BOW_DROP, HUM };

// зеркало: энергии мод NM, затем (hz, level) каждого из NV голосов, затем модель
constexpr int M_PLATE = NM + NV * 2;                     // 32
constexpr int M_F0 = M_PLATE, M_FX = M_F0 + 1, M_SEQ = M_FX + NFX;      // f0; fx × NFX; bpm, playing, rec, rlen, mlen
constexpr int M_RHY = M_SEQ + 5, M_MEL = M_RHY + SLOTS * 4;               // 16 × (on, vel, chance, has); 16 × (on, x, y)
constexpr int M_DRIFT = M_MEL + SLOTS * 3, M_MISC = M_DRIFT + 5;         // on, depth, rate, shape, k; grid, lastHit x, y, cursor, stepRec on, r, m
constexpr int M_ECHO = M_MISC + 7;                       // живых пар эха, затем время каждой (до ECHO_LIVE), длина линии в секундах
constexpr int ECHO_LIVE = 4;
constexpr int MIRROR_N = M_ECHO + 2 + ECHO_LIVE;
// услышанное: записи по 5 — [1, r, m, time, hit] на каждый сыгранный шаг, [2, нота, 0, 0, 0] — резонатор отзывается
constexpr int HEARD_REC = 5, ANSWER_CAP = 8, HEARD_MAX = (HEARD_CAP + ANSWER_CAP) * HEARD_REC;
constexpr double SEND_K = 1.4 * 2.5, SEND_TAU = 0.05;
constexpr int ECHO_MAXD = 3 * 48000;                      // линия 3 с при 48 кГц (как DelayNode(3)); 2.25 с — самая длинная доля
constexpr int ECHO_POOL = 6, HUM_N = 8;                   // пар (до 4 живых + затухающие) и голосов гула (жизнь 1.65 с, не чаще раза в 0.25 с)

class Cymatica : public sdk::World, private Sink {
 public:
  explicit Cymatica(const Scale& scale) : model_(scale) { model_.bind(this); }
  void prepare(double sr, uint32_t seed) override;
  void action(int kind, int i, const double* a, int n) override;
  void process(const sdk::Out& out, int n) override;
  sdk::Rev rev() const override { return sdk::Rev::plate; }
  int mirror(double* buf, int cap) const override;
  int heard(double* buf, int cap) override;
  std::string snapshot() const override { return model_.snapshot(); }
  void restore(const std::string& js) override { model_.restore(js); }
  bool sounding() const override;
  const Plate& plate() const { return plate_; }
  double trim() const override { return 2.5; }          // как engine.js: сухой выход ×2.5 перед каналом микшера
  const Model& model() const { return model_; }

 private:
  void seq(const double* a) override { plate_.seq(a, SEQ_N); }
  void f0(double hz) override { plate_.f0(hz); }
  void params(double s, double d, double b) override { plate_.params(s, d, b); }
  void hall(double h) override { hall_ = h; }
  void strike(double x, double y, double hz, bool rec) override { plate_.strike(x, y, hz, 1, 0.5, rec); }
  void answer(int semi) override;
  void bow(int id, bool on, double x, double y, double exciter, double pressure, double amp) override { plate_.bow(id, on, x, y, exciter, pressure, amp); }

  struct Pair {
    sdk::PingPong<ECHO_MAXD> pp;
    sdk::OnePole gate, out;                               // вход пары (tau 0.01 с) и выход (tau — затухание при снятии)
    double gateTo = 0, outTo = 1, outC = 0, sec = 0, retireAt = -1, dieAt = -1;
    long serial = 0;
    bool used = false, live = false;
  };
  struct Hum { sdk::Osc a, b; sdk::AD env; double f1 = 0, f2 = 0; };
  Pair* curPair();
  void retime();
  void dropPair(Pair& p, double fade);
  double echoSec() const;
  double echoFb() const { return 0.35 + 0.45 * model_.fx(ECHO); }

  Model model_;
  Plate plate_;
  sdk::OnePole send_;
  double hall_ = 0.25, sendC_ = 0, sr_ = 48000;
  int ans_[ANSWER_CAP] = {};
  int nAns_ = 0;
  bool humOn_ = true;
  double time_ = 0, echoAt_ = -1e9, humAt_ = -1e9, gateC_ = 0;
  long pairSerial_ = 0;
  sdk::OnePole echoSend_;
  Pair pairs_[ECHO_POOL];
  Hum hum_[HUM_N];
};

}  // namespace cymatica
