// Firmamentum — модель в ядре: звёзды-проколы на своде, общие FX, комета. Порт worlds/firmamentum/model.js один в один
// (тот же порядок вызовов rng, те же пороги по времени — шаг раз в блок process), без DOM и звука; лад — у хоста (Scale).
// Что должно прозвучать — события слушателю (emit): звезда целиком, одна её частота (fp / ff), fx — как listen у JS-модели.
// Комета без экрана: расстояние — в координатах свода place(s) = {x: u, y: −h·K}, порог R (на 390×844 — те же 90 px).
#pragma once
#include <cstdint>
#include <string>
#include "../../sdk/rng.hpp"
#include "../../host/scale.hpp"

namespace firmamentum {

constexpr int SMAX = 6;
constexpr double FP_LO = 0.7, FP_HI = 520, FF_LO = 140, FF_HI = 4800;
// свод → экран 390×844: geo(T) в worlds/firmamentum/view.js даёт RX = 187, RY = 1.75·RX (купол упирается в ширину; от safe-area
// не зависит — посчитано в Node для вставок 0/0 и 47/34). Единица свода по горизонтали — RX·0.94 px у горизонта (fromSky),
// по высоте — RY px, отсюда K = RY / (RX·0.94); 90 px комете — R единиц свода. На других экранах радиус чуть другой (принято).
constexpr double K = 1.75 / 0.94;
constexpr double R = 90 / (187 * 0.94);

enum Fx { SCINTILLA, DRIFT, COMETA, CREPITUS, FULGUR, SPREAD, HALL, NFX };   // порядок — FX_DEF в model.js
enum Key { CYC, WIN, MASK, LVL, H, U, NKEY };          // что звезды правит set (h, u — тоже)
extern const char* const FX_NAMES[NFX];
extern const double FX_DEF[NFX];

struct Star {
  int slot = 0, id = 0;
  double h = 0, u = 0;                                  // h: 0 горизонт … 1 зенит; u: −1 … 1 по своду
  double cyc = 3, win = 0.2, mask = 0, lvl = 0.8;
  double dr = 0, ph = 0, cm = 1;                        // drift формантов (октавы), его фаза, разгон кометой
};
struct Pt { double h = 0, u = 0; };
struct Comet { Pt a, b; double t0 = 0, dur = 0; };

struct Ev {
  enum Type { STAR, FP, FF, FX } t;
  const Star* s;                                        // для FX — nullptr
  bool on, added;
};

class Model {
 public:
  explicit Model(const Scale& scale) : scale_(scale) {}
  void reset(uint32_t seed);                            // пустой свод, FX по умолчанию, время 0
  void listen(void (*fn)(void*, const Ev&), void* ctx) { emit_ = fn; ctx_ = ctx; }

  double fp(const Star& s) const;                       // высота — частота пульсаций; в области тона с ладом — по ступеням
  double ff(const Star& s) const;                       // место по своду — формант (с drift)

  Star* add(double h, double u, int slot = -1, int id = 0);          // slot/id от UI; занят или −1/0 — первый свободный / следующий (правило id — world.hpp, ADD)
  void close(int id);
  void move(int id, double h, double u);
  void set(int id, int key, double v);
  void setFx(int k, double v);
  void clear();
  void dice();
  void launch() { cometNext_ = -1; }                    // комета — на следующем шаге
  void tick(double dt);

  std::string snapshot() const;                         // тот же JSON, что у model.js: {s: [{h,u,cyc,win,mask,lvl}], fx}
  void restore(const std::string& js);                  // у звезды может быть ещё slot и id — как у add (так шлёт фасад в вебе)

  int count() const { return n_; }
  const Star& star(int i) const { return stars_[i]; }
  Star* find(int id);
  const Star* find(int id) const;
  double fx(int k) const { return fx_[k]; }
  double time() const { return time_; }
  int comets() const { return comets_; }
  const Comet* comet() const { return hasComet_ ? &comet_ : nullptr; }

 private:
  void emit(Ev::Type t, const Star* s, bool on = true, bool added = false) { if (emit_) emit_(ctx_, Ev{t, s, on, added}); }
  void closeAt(int i);
  void cometTick(double now);

  const Scale& scale_;
  sdk::Rng rng_{1};
  Star stars_[SMAX];                                    // по порядку добавления, как массив в JS
  int n_ = 0, serial_ = 0, comets_ = 0;
  double fx_[NFX] = {};
  double time_ = 0, cometNext_ = 0, cometSent_ = 0, driftAt_ = 0;
  bool hasComet_ = false;
  Comet comet_;
  void (*emit_)(void*, const Ev&) = nullptr;
  void* ctx_ = nullptr;
};

}  // namespace firmamentum
