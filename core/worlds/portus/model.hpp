// Portus — модель в ядре: 16 мест фарватера с корабликами, луна-фильтр, буй-эхо, туман, маяк (аккорд, октава), FX, темп. Порт
// worlds/portus/model.js (теперь эталон — tools/ref/portus-model.js) один в один; лад и тоника — у хоста (const Scale&). Своего времени
// у модели нет: шаги ставит мир (sdk::Steps), модель говорит, чем звучит место (hzOf) и сколько до следующего удара. Случайность —
// не здесь: зерно качания кораблика приходит в действии (его бросает фасад), шанс удара (chance) — ГСЧ мира, кубик — в фасаде.
#pragma once
#include <string>
#include "../../host/scale.hpp"

namespace portus {

constexpr int NSTEP = 16, NCHORD = 5;
constexpr double PSPAN = 12;                           // поперёк фарватера — октава
extern const double DT[5];                             // время эха в шестнадцатых

struct Isle { bool on = false; double p = 0, oct = 0, lvl = 1, sd = 0; };   // место занято; нота поперёк 0…12; сдвиг октавы; громкость; зерно качания

enum LunaKey { CUT, RES, ENV, NLUNA };
enum EchoKey { TIME, TONE, MIX, FB, NECHO };           // FB — только для действия (плашка: 0…1, буй встаёт по нему)
enum FogKey { AMT, SIZE, NFOG };
enum PharosKey { CHORD, OCT, LEN, LVL, SWING, NPHAROS };
enum FxKey { WOW, MARE, DRIVE, SPREAD, CHANCE, NFX };
enum IsleKey { IOCT, ILVL };

// берега бухты (доля полуширины воды, d — 0 у набережной … 1 на горизонте), как edge в model.js
double edge(int side, double d);

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) { reset(); }
  void reset();

  // кораблики
  void place(int i, double p, double sd);              // место занято — кораблик переплывает на новую ноту (зерно прежнее)
  void sink(int i);
  void move(int from, int to);                         // только на свободное место
  void setNote(int i, double p);
  void setIsle(int i, int key, double v);
  void clearIsles();
  // сцена
  void setLuna(int k, double v);
  void setBuoy(double u, double d);                    // тянут буй: вдаль — повторы, поперёк между берегами — время эха
  void setEcho(int k, double v);
  void setFog(int k, double v);
  void setPharos(int k, double v);
  void setBpm(double b) { bpm_ = b; }
  void setFx(int k, double v);

  // высота и шина
  double semiOf(int i) const;                          // тоника от A2: полутоны (с ладом — ступени) плюс октава маяка и кораблика
  double hzOf(int i) const;
  double fcOf() const;                                 // срез луны: 90 Гц … 13 кГц
  double fbOf() const;                                 // обратная связь эха от дальности буя, 0.15 … 0.985
  double stepSec() const { return 60 / bpm_ / 4; }

  const Isle& isle(int i) const { return s_[i]; }
  int count() const;
  double luna(int k) const { return luna_[k]; }
  double echo(int k) const { return echo_[k]; }
  double buoyU() const { return buoyU_; }
  double buoyD() const { return buoyD_; }
  double fog(int k) const { return fog_[k]; }
  double pharos(int k) const { return pharos_[k]; }
  double fx(int k) const { return fx_[k]; }
  double bpm() const { return bpm_; }

  std::string snapshot() const;                        // тот же JSON, что у model.js: {isles: [{step, p, oct, lvl, sd}], luna, echo, buoy, fog, pharos, fx, bpm}
  void restore(const std::string& js);

 private:
  void buoyFromEcho();                                 // буй поперёк — по времени эха

  const Scale& scale_;
  Isle s_[NSTEP];
  double luna_[NLUNA] = {}, echo_[3] = {}, fog_[NFOG] = {}, pharos_[NPHAROS] = {}, fx_[NFX] = {};
  double buoyU_ = 0.35, buoyD_ = 0.45, bpm_ = 120;
};

}  // namespace portus
