// Arcadia — модель в ядре: страна (land.hpp), странники по слотам 0…3 в порядке добавления, fx, пути, нота. Порт
// tools/ref/arcadia-model.js (worlds/arcadia/model.js до SDK D3) без картинки: след блуждания, кубик и id странников — в фасаде веба
// (у фасада и своя genLand — рисовать страну, пока ядра нет). Своего ГСЧ у модели нет.
// Страна: звучит cur(); новая (newLand) считается по кускам в другой половине буфера — stepLand() раз в блок; ровно через LAND_BLOCKS
// блоков (сколько бы кусков ни ушло) — готова: cur() меняется, пути river / summit пересчитываются (до того — по звучащей стране).
#pragma once
#include <string>
#include "../../host/scale.hpp"
#include "land.hpp"

namespace arcadia {

constexpr int VMAX = 4, SEMIS = 24;
constexpr double K = 2.4;                               // сила перспективы: нота ровно по высоте экрана (depthOf)
constexpr uint32_t SEED0 = 20261021;
constexpr int LAND_BLOCKS = LandGen::MAX_STEPS;         // новая страна звучит через столько блоков после LAND (≈ 0.16 с при 48 кГц)
constexpr int RMAX_PTS = 2 + 2 * 90;                    // путь routeOf: дом + до 90 шагов
enum Fx { RELIEF, PACE, WIND, CHORUS, PHASER, SPREAD, HALL, NFX };   // порядок — FX_DEF в model.js
enum Key { U, V, OCT, R, FIG, MODE, SP, LVL, NKEY };   // порядок — T_KEYS (снимок странника)
extern const char* const FX_NAMES[NFX];
extern const char* const KEY_NAMES[NKEY];
extern const double FX_DEF[NFX];
extern const double KEY_DEF[NKEY];

struct Trav {
  bool on = false;
  double k[NKEY] = {};                                  // u, v, oct, r, fig, mode, sp, lvl
  double route[RMAX_PTS] = {};                          // путь (mode ≥ 3), иначе n = 0 — null
  int n = 0;
};

double depthOf(double v);                               // 0 у нижней рамки … 1 на горизонте — ровно по экрану

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) {}
  void reset();                                         // страна SEED0 целиком, без странников, fx по умолчанию

  bool add(int slot, const double* k);                  // занят — false
  void drop(int slot);
  void move(int slot, double u, double v);
  void set(int slot, int key, double v);
  void setFx(int k, double v) { if (k >= 0 && k < NFX) fx_[k] = v; }
  void newLand(uint32_t seed);                          // начать новую страну (по кускам)
  bool stepLand();                                      // кусок; true — новая страна только что стала звучащей
  void route(int slot);                                 // пересчитать путь по звучащей стране

  double hzOf(int slot) const;
  std::string snapshot() const;                         // {seed, t: [{u, v, oct, r, fig, mode, sp, lvl}], fx} — как model.js
  bool sounding() const { return nord_ > 0; }

  const Trav& t(int slot) const { return t_[slot]; }
  int count() const { return nord_; }
  int order(int k) const { return ord_[k]; }
  double fx(int k) const { return fx_[k]; }
  const Land& cur() const { return *cur_; }
  uint32_t seed() const { return want_; }               // зерно страны, какой она будет (снимок)
  bool pending() const { return gen_.busy() || waiting_; }
  int freeSlot() const;

 private:
  const Scale& scale_;
  Trav t_[VMAX];
  int ord_[VMAX] = {}, nord_ = 0;
  double fx_[NFX] = {};
  Land a_, b_;
  Land* cur_ = &a_;
  LandGen gen_;
  bool waiting_ = false;                                // кусков больше нет, ждём LAND_BLOCKS
  int blocks_ = 0;
  uint32_t want_ = SEED0;
};

}  // namespace arcadia
