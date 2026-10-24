// Cymatica — модель в ядре: пластина (высота, веер FX), секвенсер — ритм и мелодия своей длины (полиритм), луна, запись игрой.
// Порт worlds/cymatica/model.js + core.js (до этапа 2 — tools/ref/cymatica-model.js) один в один: тот же порядок вызовов rng, те же формулы.
// Лад и тоника — у хоста (const Scale&). Времени кадров нет: луна и запись игрой идут от часов ядра — `tick(dt)` раз в блок (секунды
// звукового потока), шаг пластины, под который попал удар, приходит параметром (`Phase`). Что должно прозвучать — слушателю (`Sink`):
// узор целиком (плоский массив SEQ_N чисел — тот же, что у action SEQ пластины), высота, ручки тела, зал, удар, «отзыв» резонатора.
#pragma once
#include <cstdint>
#include <string>

#include "../../host/scale.hpp"
#include "../../sdk/rng.hpp"

namespace cymatica {

constexpr int SLOTS = 16;
constexpr int SEQ_N = 5 + SLOTS * 3 + SLOTS * 4;        // как в plate.hpp
constexpr double F_MIN = 55, F_MAX = 880, F_DEF = 110;
constexpr int NOTE_TOP = 60;                             // 55–1760 Гц: 61 полутон
constexpr int SEMI_TOP = 48;                             // ступени для луны, кубика и щипка (scaleSemis): 0–48

enum Fx { STRUCTURE, DAMPING, BRIGHTNESS, HALL, ECHO, TIME, CHANCE, NFX };   // порядок — plate.fx в model.js
extern const char* const FX_NAMES[NFX];
enum DriftKey { D_DEPTH, D_RATE, D_SHAPE };

struct RStep { bool on = false; double vel = 1, chance = 1; bool hasChance = false; };   // удар (chance — только если его задавали, как в JS)
struct MStep { bool on = false; double x = 0, y = 0; };                                    // место на пластине
struct Phase { bool valid = false; int r = 0, m = 0; double steps = 0; };                  // последний тик часов: шаги ритма и мелодии, прошло шагов (дробно)

// слушатель модели — мир (он зовёт пластину)
struct Sink {
  virtual ~Sink() = default;
  virtual void seq(const double* a) = 0;                 // узор целиком — SEQ_N чисел
  virtual void f0(double hz) = 0;
  virtual void params(double structure, double damping, double brightness) = 0;
  virtual void hall(double h) = 0;
  virtual void strike(double x, double y, double hz, bool rec) = 0;
  virtual void answer(int semi) = 0;                     // нота удара = основной тон пластины по классу высоты — резонатор отзовётся
  virtual void bow(int id, bool on, double x, double y, double exciter, double pressure, double amp) = 0;   // закреплённый смычок
};

constexpr int MAX_PBOWS = 6;                              // закреплённых смычков (view держит три); у пластины гнёзд 8 — остальное живым пальцам
struct PBow { int pid = 0; double x = 0, y = 0, exciter = 0, pressure = 0.5, amp = 0.8; };

struct Note { bool ok = false; int semi = 0; };

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(1); }
  void reset(uint32_t seed);
  void bind(Sink* s) { sink_ = s; }

  // ---------- читатели ----------
  double f0() const { return f0_; }
  double fx(int k) const { return fx_[k]; }
  double bpm() const { return bpm_; }
  bool playing() const { return playing_; }
  bool rec() const { return rec_; }
  int rlen() const { return rlen_; }
  int mlen() const { return mlen_; }
  const RStep& rhythm(int i) const { return rhythm_[i]; }
  const MStep& melody(int i) const { return melody_[i]; }
  bool driftOn() const { return driftOn_; }
  double driftPar(int k) const { return k == D_DEPTH ? depth_ : k == D_RATE ? rate_ : shape_; }
  int driftK() const { return driftK_; }
  int grid() const { return grid_; }
  double lastHitX() const { return hitX_; }
  double lastHitY() const { return hitY_; }
  int cursor() const { return cursor_; }                 // −1 — нет
  bool stepRec() const { return sr_; }
  int stepRecR() const { return srR_; }
  int stepRecM() const { return srM_; }
  bool sounding() const;                                 // часы идут с ударами и местами

  // ---------- лад и раскладка (core.js) ----------
  int noteList(int* out) const;                          // 0…60 полутонов, 55–1760 Гц; число нот
  int degPerOct() const;
  int scaleSemis(int* out) const;                        // 0…48
  double effF0() const;                                  // высота с луной
  double fs() const;                                     // полутоны от 55 Гц
  int base() const;                                      // индекс ступени пластины в noteList
  Note noteOf(double x, double y) const;                 // нота места: клетка под ним; нет — молчит

  // ---------- действия (имена и порядок — worlds/cymatica/model.js) ----------
  void strikeAt(double x, double y, const Phase& ph);    // живой удар: звук, запись игрой, запись по шагам, пошаговый ввод
  void play(bool on);
  void setRec(bool on);
  void stepRecToggle();
  void setStepRec(bool on, int r, int m);                // абсолютно (фасад после перезапуска звука)
  void skipStep();
  void setCursor(int i);
  void cycleGrid();
  void setGrid(int g);
  void setF0(double hz);
  void stepScale(double fromSemi, int steps);
  void setBpm(double bpm);
  void setLen(int ring, int len);                        // ring 0 — ритм, 1 — мелодия
  void setChance(int i, double ch);
  void toggleBeat(int i);
  void nudgeNote(int i, int ci, int steps);
  void moveMark(int i, double x, double y);
  void dropMark(int i);
  void comb();
  void turn(int target, const double* orig, int k);      // target 0 — ритм, 1 — мелодия, 2 — пластина; orig — 16 шагов (on, vel, chance, has | on, x, y)
  void toggleDrift();
  void setDrift(int key, double t);
  void setFx(int k, double t);
  void loadFx(const double* a);                          // NFX значений (chance сбрасывается, как Object.assign({chance: 1}, o))
  void dice(uint32_t seed);
  void clear();
  void addBow(double x, double y);                       // закреплённый смычок: гнездо — по порядку списка (как plate.bows у фасада)
  void setBow(int i, double x, double y, double exciter, double pressure, double amp);
  void dropBow(int i);
  int nBows() const { return nBows_; }
  const PBow& bowAt(int i) const { return bows_[i]; }
  void load(const double* a);                            // готовый узор: bpm, rlen, mlen, 16 × (on, vel, chance, has), 16 × (on, x, y)
  void tick(double dt);                                  // луна; лад сменили — ноты в пластину заново
  void answerCheck(int semi);                            // нота удара совпала с основным тоном пластины по классу высоты — слушателю «отзыв»

  std::string snapshot() const;                          // тот же JSON, что у model.js: {f0, fx, bows, seq, drift}
  void restore(const std::string& js);

 private:
  void sendSeq();
  void sendF0() { if (sink_) sink_->f0(effF0()); }
  void sendParams() { if (sink_) sink_->params(fx_[STRUCTURE], fx_[DAMPING], fx_[BRIGHTNESS]); }
  void recordHit(double x, double y, const Phase& ph);
  void fillMelody();
  void fillRhythm();
  void driftTick();
  int driftDepthI() const;
  double driftPer() const;
  uint32_t scaleKey() const { return scale_.on ? 1u | (static_cast<uint32_t>(scale_.idx) << 1) | (static_cast<uint32_t>(scale_.root) << 8) : 0u; }

  const Scale& scale_;
  Sink* sink_ = nullptr;
  sdk::Rng rng_{1};
  double f0_ = F_DEF;
  double fx_[NFX] = {};
  double bpm_ = 96;
  bool playing_ = false, rec_ = false;
  int rlen_ = 16, mlen_ = 7;
  RStep rhythm_[SLOTS];
  MStep melody_[SLOTS];
  bool driftOn_ = false;
  double depth_ = 0.3, rate_ = 0.5, shape_ = 0, t0_ = 0;
  int driftK_ = 0, driftRk_ = 0;
  long driftLast_ = -1;
  PBow bows_[MAX_PBOWS];
  int nBows_ = 0, bowSerial_ = 0;                        // номер для id у пластины (1000 + …: id живых пальцев — мелкие)
  void bowOn(const PBow& b) { if (sink_) sink_->bow(b.pid, true, b.x, b.y, b.exciter, b.pressure, b.amp); }
  void bowsOff();
  int grid_ = 1;
  double hitX_ = 0.3, hitY_ = 0;
  int cursor_ = -1;
  bool sr_ = false;
  int srR_ = 0, srM_ = 0;
  double time_ = 0;
  uint32_t sentKey_ = 0;
};

}  // namespace cymatica
