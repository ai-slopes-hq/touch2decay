// Cymatica — модель в ядре, см. model.hpp. Порт worlds/cymatica/model.js и core.js (эталон — tools/ref/cymatica-model.js): порядок
// вызовов rng и формулы — как там, чтобы одно зерно давало тот же узор.
#include "model.hpp"

#include <algorithm>
#include <cmath>

#include "../../sdk/jsmath.hpp"
#include "../../sdk/json.hpp"

namespace cymatica {

const char* const FX_NAMES[NFX] = {"structure", "damping", "brightness", "hall", "echo", "time", "chance"};
namespace {

constexpr double TAU = 6.283185307179586;
const double RING_R[3] = {0.9, 0.7, 0.33};               // середины колец (core.js RING_R)
constexpr int RATES[5] = {16, 8, 4, 2, 1};               // DRIFT_RATES: такт луны в четвертях

double clampd(double x, double a, double b) { return std::min(b, std::max(a, x)); }
int clampi(int x, int a, int b) { return std::min(b, std::max(a, x)); }
double r4(double x) { return sdk::jsRound(x * 1e4) / 1e4; }

int nearestIdx(const int* list, int n, double s) {
  int j = 0;
  for (int i = 1; i < n; i++) if (std::fabs(list[i] - s) < std::fabs(list[j] - s)) j = i;
  return j;
}
// клетка пластины: b — индекс ступени пластины в списке; кольцо 0 — край (ниже), 2 — центр (выше); сектор — от верха по часовой
int cellIdx(double x, double y, int b, int n) {
  const double r = std::hypot(x, y);
  if (r > 1) return -1;
  const int ring = r > std::sqrt(2.0 / 3) ? 0 : r > std::sqrt(1.0 / 3) ? 1 : 2;
  const double a = r < 1e-9 ? 0 : std::fmod(std::atan2(x, -y) + TAU, TAU);
  return b + ring * n + (static_cast<int>(std::floor((a / TAU) * n)) % n);
}
struct Cell { int ring, sector; };
bool cellOf(int idx, int b, int n, Cell& c) {
  const int k = idx - b;
  if (k < 0 || k >= 3 * n) return false;
  c = {k / n, k % n};
  return true;
}
void cellCenter(int ring, int sector, int n, double& x, double& y) {
  const double a = ((sector + 0.5) / n) * TAU, r = RING_R[ring];
  x = r * std::sin(a); y = -r * std::cos(a);
}
int snapToGrid(int i, int g, int len) {                  // ближайшая доля (кратная g гнёзд) по кругу длины; при равенстве — вперёд
  int best = 0, bd = 1000000000;
  for (int c = 0; c < len; c += g) {
    const int d = std::min(std::abs(c - i), len - std::abs(c - i));
    if (d < bd || (d == bd && c > i)) { bd = d; best = c; }
  }
  return best;
}
template <class S> void rotateSteps(S* out, const S* steps, int len, int k) {
  for (int i = 0; i < SLOTS; i++) out[i] = steps[i];
  for (int i = 0; i < len; i++) out[(((i + k) % len) + len) % len] = steps[i];
}

}  // namespace

void Model::reset(uint32_t seed) {
  rng_ = sdk::Rng(seed);
  f0_ = F_DEF;
  const double def[NFX] = {2.0 / 7, 0.5, 0.5, 0.25, 0.15, 6.0 / 8, 1};
  for (int k = 0; k < NFX; k++) fx_[k] = def[k];
  bpm_ = 96; playing_ = false; rec_ = false; rlen_ = 16; mlen_ = 7;
  for (int i = 0; i < SLOTS; i++) { rhythm_[i] = RStep(); melody_[i] = MStep(); }
  driftOn_ = false; depth_ = 0.3; rate_ = 0.5; shape_ = 0; t0_ = 0; driftK_ = 0; driftRk_ = 0; driftLast_ = -1;
  grid_ = 1; hitX_ = 0.3; hitY_ = 0; cursor_ = -1; sr_ = false; srR_ = srM_ = 0; time_ = 0; sentKey_ = 0;
}

// ---------- лад и раскладка ----------
int Model::noteList(int* out) const {
  int n = 0;
  for (int s = 0; s <= NOTE_TOP; s++) {
    const bool in = scale_.on ? scale_.snapSemi(s) == s : (s % 12 == 0 || s % 12 == 3 || s % 12 == 5 || s % 12 == 7 || s % 12 == 10);
    if (in) out[n++] = s;
  }
  return n;
}
int Model::scaleSemis(int* out) const {
  int n = 0;
  for (int s = 0; s <= SEMI_TOP; s++) {
    const bool in = scale_.on ? scale_.snapSemi(s) == s : (s % 12 == 0 || s % 12 == 3 || s % 12 == 5 || s % 12 == 7 || s % 12 == 10);
    if (in) out[n++] = s;
  }
  return n;
}
int Model::degPerOct() const { return scale_.on ? 7 : 5; }   // ступеней в ладу хоста — всегда семь, без лада — пентатоника

double Model::effF0() const {
  if (!driftOn_ || !driftK_) return f0_;
  int list[SEMI_TOP + 1];
  const int n = scaleSemis(list);
  const int i = clampi(nearestIdx(list, n, 12 * std::log2(f0_ / F_MIN)) + driftK_, 0, n - 1);
  return clampd(F_MIN * std::pow(2.0, list[i] / 12.0), F_MIN, F_MAX);
}
double Model::fs() const { return 12 * std::log2(effF0() / F_MIN); }
int Model::base() const { int list[NOTE_TOP + 1]; return nearestIdx(list, noteList(list), fs()); }

Note Model::noteOf(double x, double y) const {
  int list[NOTE_TOP + 1];
  const int n = noteList(list), b = nearestIdx(list, n, fs()), i = cellIdx(x, y, b, degPerOct());
  if (i < 0 || i >= n) return {};
  return {true, list[i]};
}

bool Model::sounding() const {
  if (!playing_) return false;
  bool r = false, m = false;
  for (int i = 0; i < SLOTS; i++) { r = r || rhythm_[i].on; m = m || melody_[i].on; }
  return r && m;
}

// ---------- узор → пластина ----------
void Model::sendSeq() {
  sentKey_ = scaleKey();
  if (!sink_) return;
  double a[SEQ_N];
  a[0] = bpm_; a[1] = playing_ ? 1 : 0; a[2] = fx_[CHANCE]; a[3] = rlen_; a[4] = mlen_;
  int p = 5;
  for (int i = 0; i < SLOTS; i++) {
    const RStep& s = rhythm_[i];
    a[p++] = s.on ? 1 : 0; a[p++] = s.on ? s.vel : 0; a[p++] = s.on ? (s.hasChance ? s.chance : 1) : 1;
  }
  int list[NOTE_TOP + 1];
  const int n = noteList(list), b = nearestIdx(list, n, fs()), dn = degPerOct();
  for (int i = 0; i < SLOTS; i++) {
    const MStep& s = melody_[i];
    int idx = -1;
    if (s.on) idx = cellIdx(s.x, s.y, b, dn);
    if (s.on && idx >= 0 && idx < n) { a[p++] = 1; a[p++] = list[idx]; a[p++] = s.x; a[p++] = s.y; }   // место в молчащей клетке уходит пустым — пауза
    else { a[p++] = 0; a[p++] = 0; a[p++] = 0; a[p++] = 0; }
  }
  sink_->seq(a);
}

void Model::answerCheck(int semi) {
  const int own = static_cast<int>(sdk::jsRound(fs()));
  if (((semi - own) % 12 + 12) % 12 == 0 && sink_) sink_->answer(semi);
}

// ---------- запись игрой ----------
void Model::recordHit(double x, double y, const Phase& ph) {
  hitX_ = x; hitY_ = y;
  if (!rec_ || !playing_ || !ph.valid) return;
  const int R = rlen_, h = R / 2, adv = static_cast<int>(sdk::jsRound(ph.steps));
  const int i = (ph.r + adv) % R, j = snapToGrid(i, grid_, R);
  const int sh = ((j - i + R + h) % R) - h;               // сетка сдвинула удар — мелодия сдвигается так же
  rhythm_[j] = RStep(); rhythm_[j].on = true;
  const int k = (((ph.m + adv) % mlen_ + sh) % mlen_ + mlen_) % mlen_;
  melody_[k].on = true; melody_[k].x = x; melody_[k].y = y;
  sendSeq();
}
void Model::fillMelody() {
  bool any = false;
  for (int i = 0; i < SLOTS; i++) any = any || melody_[i].on;
  if (!any) for (int i = 0; i < mlen_; i++) { melody_[i].on = true; melody_[i].x = hitX_; melody_[i].y = hitY_; }
}
void Model::fillRhythm() {
  bool any = false;
  for (int i = 0; i < SLOTS; i++) any = any || rhythm_[i].on;
  if (!any) for (int i = 0; i < rlen_; i++) { rhythm_[i] = RStep(); rhythm_[i].on = true; }
}

void Model::strikeAt(double x, double y, const Phase& ph) {
  const Note note = noteOf(x, y);
  if (!note.ok) return;                                   // клетка за 1760 Гц молчит
  if (sink_) sink_->strike(x, y, F_MIN * std::pow(2.0, note.semi / 12.0), rec_ && playing_);
  answerCheck(note.semi);
  recordHit(x, y, ph);
  if (sr_) {                                              // запись по шагам: удар — в шаг ритма, место — в шаг мелодии; оба курсора дальше
    rhythm_[srR_] = RStep(); rhythm_[srR_].on = true;
    melody_[srM_].on = true; melody_[srM_].x = x; melody_[srM_].y = y;
    srR_ = (srR_ + 1) % rlen_; srM_ = (srM_ + 1) % mlen_;
    sendSeq();
  }
  if (cursor_ >= 0 && !playing_ && !sr_) {                // пошаговый ввод: место — в гнездо курсора, курсор дальше
    const int len = mlen_;
    MStep& s = melody_[cursor_ % len];
    s.on = true; s.x = x; s.y = y;
    cursor_ = (cursor_ % len + 1) % len;
    fillRhythm();
    sendSeq();
  }
}

void Model::play(bool on) { playing_ = on; if (!on) rec_ = false; if (on) sr_ = false; sendSeq(); }
void Model::setRec(bool on) { rec_ = on; if (on && !playing_) play(true); }
void Model::stepRecToggle() { sr_ = !sr_; if (sr_) srR_ = srM_ = 0; cursor_ = -1; }
void Model::setStepRec(bool on, int r, int m) { sr_ = on; srR_ = clampi(r, 0, SLOTS - 1); srM_ = clampi(m, 0, SLOTS - 1); cursor_ = -1; }
void Model::skipStep() {
  if (!sr_) return;
  rhythm_[srR_] = RStep(); srR_ = (srR_ + 1) % rlen_; srM_ = (srM_ + 1) % mlen_; sendSeq();
}
void Model::setCursor(int i) { cursor_ = i; }
void Model::setGrid(int g) { if (g == 1 || g == 2 || g == 4) grid_ = g; }
void Model::cycleGrid() { grid_ = grid_ == 1 ? 2 : grid_ == 2 ? 4 : 1; }

// ---------- высота ----------
void Model::setF0(double hz) {
  const double s = scale_.snapSemi(12 * std::log2(clampd(hz, F_MIN, F_MAX) / F_MIN));
  f0_ = clampd(F_MIN * std::pow(2.0, s / 12), F_MIN, F_MAX);
  sendF0();
  for (int i = 0; i < SLOTS; i++) if (melody_[i].on) { sendSeq(); break; }   // ноты едут вместе с пластиной
}
void Model::stepScale(double fromSemi, int steps) {
  int list[SEMI_TOP + 1];
  const int n = scaleSemis(list);
  setF0(F_MIN * std::pow(2.0, list[clampi(nearestIdx(list, n, fromSemi) + steps, 0, n - 1)] / 12.0));
}

// ---------- правка узора ----------
void Model::setBpm(double bpm) { bpm_ = bpm; sendSeq(); }
void Model::setLen(int ring, int len) {
  int& cur = ring == 0 ? rlen_ : mlen_;
  if (len != cur) { cur = clampi(len, 1, SLOTS); sendSeq(); }
}
void Model::setChance(int i, double ch) {
  if (i < 0 || i >= SLOTS) return;
  RStep& s = rhythm_[i];
  if (s.on && ch != (s.hasChance ? s.chance : 1)) { s.chance = ch; s.hasChance = true; sendSeq(); }
}
void Model::toggleBeat(int i) {
  if (i < 0 || i >= SLOTS) return;
  if (rhythm_[i].on) rhythm_[i] = RStep();
  else { rhythm_[i] = RStep(); rhythm_[i].on = true; }
  fillMelody();
  sendSeq();
}
void Model::nudgeNote(int i, int ci, int steps) {         // бусина: место переезжает в клетку на steps ступеней от ci
  if (i < 0 || i >= SLOTS || !melody_[i].on) return;
  int list[NOTE_TOP + 1];
  const int n = noteList(list), b = nearestIdx(list, n, fs()), dn = degPerOct(), top = std::min(b + 3 * dn, n) - 1;
  Cell cl;
  if (!cellOf(clampi(ci + steps, b, top), b, dn, cl)) return;
  double x, y;
  cellCenter(cl.ring, cl.sector, dn, x, y);
  MStep& s = melody_[i];
  if (x != s.x || y != s.y) { s.x = x; s.y = y; sendSeq(); }
}
void Model::moveMark(int i, double x, double y) {
  if (i < 0 || i >= SLOTS || !melody_[i].on) return;
  melody_[i].x = x; melody_[i].y = y; sendSeq();
}
void Model::dropMark(int i) { if (i < 0 || i >= SLOTS) return; melody_[i] = MStep(); sendSeq(); }   // за край — место удалено, шаг — пауза
void Model::comb() {                                      // причесать ритм: удары — на ближайшие доли сетки
  RStep out[SLOTS];
  for (int i = 0; i < SLOTS; i++) out[i] = rhythm_[i];
  for (int i = 0; i < rlen_; i++) out[i] = RStep();
  for (int i = 0; i < rlen_; i++) { const int j = snapToGrid(i, grid_, rlen_); if (rhythm_[i].on && !out[j].on) out[j] = rhythm_[i]; }
  for (int i = 0; i < SLOTS; i++) rhythm_[i] = out[i];
  sendSeq();
}
void Model::turn(int target, const double* orig, int k) {
  if (target == 0) {
    RStep o[SLOTS], out[SLOTS];
    for (int i = 0; i < SLOTS; i++) { const double* p = orig + i * 4; o[i].on = p[0] != 0; o[i].vel = p[1]; o[i].chance = p[2]; o[i].hasChance = p[3] != 0; if (!o[i].on) o[i] = RStep(); }
    rotateSteps(out, o, rlen_, k);
    for (int i = 0; i < SLOTS; i++) rhythm_[i] = out[i];
  } else {
    MStep o[SLOTS], out[SLOTS];
    for (int i = 0; i < SLOTS; i++) { const double* p = orig + i * 3; o[i].on = p[0] != 0; o[i].x = p[1]; o[i].y = p[2]; if (!o[i].on) o[i] = MStep(); }
    if (target == 1) rotateSteps(out, o, mlen_, k);
    else if (!k) for (int i = 0; i < SLOTS; i++) out[i] = o[i];
    else {                                                // поворот пластины: каждое место — на k ступеней, в середину клетки новой ноты
      int list[NOTE_TOP + 1];
      const int n = noteList(list), b = nearestIdx(list, n, fs()), dn = degPerOct(), top = std::min(b + 3 * dn, n) - 1;
      for (int i = 0; i < SLOTS; i++) {
        out[i] = o[i];
        if (!o[i].on) continue;
        const int ci = cellIdx(o[i].x, o[i].y, b, dn);
        Cell cl;
        if (ci < 0 || !cellOf(clampi(ci + k, b, top), b, dn, cl)) continue;
        cellCenter(cl.ring, cl.sector, dn, out[i].x, out[i].y);
      }
    }
    for (int i = 0; i < SLOTS; i++) melody_[i] = out[i];
  }
  sendSeq();
}

// ---------- луна ----------
int Model::driftDepthI() const { return std::max(1, static_cast<int>(sdk::jsRound(depth_ * 7))); }
double Model::driftPer() const { return (RATES[static_cast<int>(sdk::jsRound(rate_ * 4))] * 60.0) / bpm_; }
void Model::toggleDrift() { driftOn_ = !driftOn_; driftK_ = 0; t0_ = time_; driftLast_ = -1; sendF0(); sendSeq(); }
void Model::setDrift(int key, double t) {
  if (key == D_DEPTH) depth_ = t; else if (key == D_RATE) rate_ = t; else shape_ = t;
  if (!driftOn_) { driftOn_ = true; t0_ = time_; driftLast_ = -1; }
}
void Model::driftTick() {                                 // луна качает пластину: новая ступень — пластина и ноты едут
  if (!driftOn_) { if (driftK_) { driftK_ = 0; sendF0(); sendSeq(); } return; }
  const double ph = (time_ - t0_) / driftPer();
  const int D = driftDepthI();
  int k;
  if (shape_ < 0.5) k = static_cast<int>(sdk::jsRound(D * std::sin(ph * TAU)));
  else {                                                  // random — новая ступень дважды за период
    const long n = static_cast<long>(std::floor(ph * 2));
    if (n != driftLast_) { driftLast_ = n; driftRk_ = static_cast<int>(sdk::jsRound((rng_.next() * 2 - 1) * D)); }
    k = driftRk_;
  }
  if (k != driftK_) {
    driftK_ = k; sendF0();
    for (int i = 0; i < SLOTS; i++) if (melody_[i].on) { sendSeq(); break; }
  }
}

void Model::tick(double dt) {
  time_ += dt;
  driftTick();
  if (scaleKey() != sentKey_) for (int i = 0; i < SLOTS; i++) if (melody_[i].on) { sendSeq(); break; }   // лад сменили — ноты заново
}

// ---------- веер FX ----------
void Model::setFx(int k, double t) {
  if (k < 0 || k >= NFX) return;
  fx_[k] = t;
  if (k == CHANCE) sendSeq();
  else if (k == HALL) { if (sink_) sink_->hall(t); }
  else if (k == ECHO || k == TIME) {}                      // эхо — у engine (Web Audio, этап 3)
  else sendParams();
}
void Model::loadFx(const double* a) {
  for (int k = 0; k < NFX; k++) fx_[k] = a[k];
  sendParams();
  if (sink_) sink_->hall(fx_[HALL]);
  sendSeq();
}

// ---------- патч ----------
void Model::dice(uint32_t seed) {                         // генеративный узор: ритм по Евклиду, мелодия другой длины по ладу — полиритм
  sdk::Rng R(seed);
  const int n = 8 + static_cast<int>(std::floor(R.next() * 9)), k = 3 + static_cast<int>(std::floor(R.next() * (n - 4)));
  bool e[SLOTS] = {};
  for (int i = 0; i < n; i++) e[i] = (i * k) % n < k;     // euclid(k, n)
  int m = 3 + static_cast<int>(std::floor(R.next() * 6));
  while (n % m == 0) m++;                                 // длина мелодии не делит ритм — ноты ложатся на удары по-новому каждый круг
  int list[NOTE_TOP + 1];
  const int nl = noteList(list), b = nearestIdx(list, nl, fs()), dn = degPerOct();   // ноты — блуждание по ладу по всем трём кольцам
  const int sn = std::min(b + 3 * dn, nl) - b;            // span = list.slice(b, min(b + 3·dn, length))
  const int* span = list + b;
  const double start = span[static_cast<int>(std::floor(R.next() * sn))];   // со случайной ноты — иначе от края до центра не дойдёт
  int w[SLOTS];
  {                                                       // walkMelody(m, start, span, R)
    int i = 0;
    for (int q = 1; q < sn; q++) if (std::fabs(span[q] - start) < std::fabs(span[i] - start)) i = q;
    static const int D[4] = {-2, -1, 1, 2};
    for (int q = 0; q < m; q++) {
      w[q] = span[i];
      const int d = D[static_cast<int>(std::floor(R.next() * 4))];
      i = std::min(sn - 1, std::max(0, i + d));
    }
  }
  for (int i = 0; i < SLOTS; i++) { rhythm_[i] = RStep(); rhythm_[i].on = i < n && e[i]; }
  rlen_ = n;
  for (int i = 0; i < SLOTS; i++) {
    melody_[i] = MStep();
    if (i >= m) continue;
    int idx = 0;
    for (int q = 0; q < nl; q++) if (list[q] == w[i]) { idx = q; break; }
    Cell cl = {0, 0};
    cellOf(idx, b, dn, cl);
    double px, py;
    cellCenter(cl.ring, cl.sector, dn, px, py);
    const double r = std::hypot(px, py) + (R.next() - 0.5) * 0.1;
    const double a = std::atan2(py, px) + (R.next() - 0.5) * 0.6 * (TAU / dn);   // сдвиг внутри клетки — тембр разный
    melody_[i].on = true; melody_[i].x = r * std::cos(a); melody_[i].y = r * std::sin(a);
  }
  mlen_ = m;
  playing_ = true; sr_ = false;
  sendSeq();
}

void Model::clear() {                                     // узор — прочь; длины колец и часы остаются
  for (int i = 0; i < SLOTS; i++) { rhythm_[i] = RStep(); melody_[i] = MStep(); }
  sendSeq();
}

void Model::load(const double* a) {
  bpm_ = a[0]; rlen_ = clampi(static_cast<int>(a[1]), 1, SLOTS); mlen_ = clampi(static_cast<int>(a[2]), 1, SLOTS);
  const double* p = a + 3;
  for (int i = 0; i < SLOTS; i++, p += 4) {
    rhythm_[i] = RStep();
    if (p[0] != 0) { rhythm_[i].on = true; rhythm_[i].vel = p[1]; rhythm_[i].chance = p[2]; rhythm_[i].hasChance = p[3] != 0; }
  }
  for (int i = 0; i < SLOTS; i++, p += 3) { melody_[i] = MStep(); if (p[0] != 0) { melody_[i].on = true; melody_[i].x = p[1]; melody_[i].y = p[2]; } }
  sendSeq();
}

// ---------- снимок ----------
std::string Model::snapshot() const {
  using sdk::Json;
  Json st = Json::object(), fx = Json::object(), seq = Json::object(), dr = Json::object();
  st.set("f0", Json::num(r4(f0_)));
  for (int k = 0; k < NFX; k++) fx.set(FX_NAMES[k], Json::num(r4(fx_[k])));
  st.set("fx", std::move(fx));
  st.set("bows", Json::array());                          // закреплённые смычки (выключены BOWS_ON) пока ведёт фасад
  Json rh = Json::object(), me = Json::object(), rs = Json::array(), ms = Json::array();
  for (int i = 0; i < SLOTS; i++) {
    if (!rhythm_[i].on) { rs.push(Json()); continue; }
    Json o = Json::object();
    o.set("vel", Json::num(rhythm_[i].vel));
    if (rhythm_[i].hasChance) o.set("chance", Json::num(rhythm_[i].chance));
    rs.push(std::move(o));
  }
  for (int i = 0; i < SLOTS; i++) {
    if (!melody_[i].on) { ms.push(Json()); continue; }
    Json o = Json::object();
    o.set("x", Json::num(melody_[i].x)); o.set("y", Json::num(melody_[i].y));
    ms.push(std::move(o));
  }
  rh.set("len", Json::num(rlen_)); rh.set("steps", std::move(rs));
  me.set("len", Json::num(mlen_)); me.set("steps", std::move(ms));
  seq.set("bpm", Json::num(bpm_)); seq.set("rhythm", std::move(rh)); seq.set("melody", std::move(me));
  st.set("seq", std::move(seq));
  dr.set("on", Json::boolean(driftOn_)); dr.set("depth", Json::num(depth_)); dr.set("rate", Json::num(rate_)); dr.set("shape", Json::num(shape_));
  st.set("drift", std::move(dr));
  return st.dump();
}

void Model::restore(const std::string& js) {
  using sdk::Json;
  bool ok = false;
  const Json st = Json::parse(js, &ok);
  if (!ok || st.type != Json::Obj) return;
  const auto num = [](const Json& o, const char* k, double& v) { const Json* x = o.get(k); if (x && x->type == Json::Num) v = x->n; };
  const auto flag = [](const Json& o, const char* k, bool& v) { const Json* x = o.get(k); if (x && x->type == Json::Bool) v = x->b; };
  num(st, "f0", f0_);
  fx_[CHANCE] = 1;                                        // старый снимок без chance — 1
  if (const Json* fx = st.get("fx"); fx && fx->type == Json::Obj) for (int k = 0; k < NFX; k++) num(*fx, FX_NAMES[k], fx_[k]);
  if (const Json* dr = st.get("drift"); dr && dr->type == Json::Obj) {
    flag(*dr, "on", driftOn_); num(*dr, "depth", depth_); num(*dr, "rate", rate_); num(*dr, "shape", shape_);
  }
  driftK_ = 0; sr_ = false;
  if (const Json* sq = st.get("seq"); sq && sq->type == Json::Obj) {
    num(*sq, "bpm", bpm_);
    const auto ring = [&](const char* key, int& len, bool rhy) {
      const Json* r = sq->get(key);
      if (!r || r->type != Json::Obj) return;
      double l = len;
      num(*r, "len", l);
      len = clampi(static_cast<int>(l), 1, SLOTS);
      const Json* steps = r->get("steps");
      for (int i = 0; i < SLOTS; i++) {
        const Json* s = steps && steps->type == Json::Arr && i < static_cast<int>(steps->a.size()) ? &steps->a[i] : nullptr;
        const bool has = s && s->type == Json::Obj;
        if (rhy) {
          rhythm_[i] = RStep();
          if (has) { rhythm_[i].on = true; num(*s, "vel", rhythm_[i].vel); if (const Json* c = s->get("chance"); c && c->type == Json::Num) { rhythm_[i].chance = c->n; rhythm_[i].hasChance = true; } }
        } else {
          melody_[i] = MStep();
          if (has) { melody_[i].on = true; num(*s, "x", melody_[i].x); num(*s, "y", melody_[i].y); }
        }
      }
    };
    ring("rhythm", rlen_, true); ring("melody", mlen_, false);
  }
  sendF0(); sendParams();
  if (sink_) sink_->hall(fx_[HALL]);
  sendSeq();
}

}  // namespace cymatica
