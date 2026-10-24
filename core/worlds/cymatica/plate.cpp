// Cymatica — звук пластины и часы, см. plate.hpp. Порядок вычислений и вызовов ГСЧ — как в tools/ref/plate-worklet.js (сверка 1e-6).
#include "plate.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace cymatica {
namespace {

const double PI = 3.141592653589793;
constexpr double F_LO = 55, BOW_TILT = 1.5, BOW_GAIN = 6, OUT_GAIN = 0.2, STRIKE_GAIN = 5, SLEEP = 1e-14;

double clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
double lerpLog(double a, double b, double t) { return a * std::pow(b / a, t); }

// функция Бесселя первого рода — степенной ряд: для x ≤ 20 и m ≤ 8 точности хватает с запасом
double besselJ(int m, double x) {
  double term = std::pow(x / 2, m);
  for (int i = 2; i <= m; i++) term /= i;
  double sum = term;
  const double q = -(x * x) / 4;
  for (int k = 1; k < 120; k++) {
    term *= q / (k * (k + m));
    sum += term;
    if (k > x && std::fabs(term) < 1e-17) break;
  }
  return sum;
}

// 24 моды круглой пластины: пары (m — узловые диаметры 0–8, n — узловые окружности 1–4) по возрастанию нуля j(m,n);
// NORM — максимум |J_m(j·r)| на r ∈ [0, 1], TUNINGS — 8 тел по лучу structure: струна, мембрана, пластина, колокол, чаша, ханг, маримба, калимба
struct Mode { int m, n; double j; };
struct Tables {
  Mode modes[NM];
  double norm[NM];
  double tun[8][NM];
  Tables() {
    Mode all[9 * 4];
    int na = 0;
    for (int m = 0; m <= 8; m++) {
      int n = 0;
      double x0 = 0.05, f0 = besselJ(m, x0);
      for (double x = 0.1; x < 20 && n < 4; x += 0.05) {
        const double f = besselJ(m, x);
        if (f0 * f < 0) {                                  // смена знака — уточняем бисекцией
          double a = x - 0.05, b = x;
          for (int i = 0; i < 60; i++) { const double c = (a + b) / 2; if (besselJ(m, a) * besselJ(m, c) <= 0) b = c; else a = c; }
          all[na++] = {m, ++n, (a + b) / 2};
        }
        f0 = f;
      }
    }
    std::stable_sort(all, all + na, [](const Mode& p, const Mode& q) { return p.j - q.j < 0; });
    for (int k = 0; k < NM; k++) modes[k] = all[k];
    for (int k = 0; k < NM; k++) {
      norm[k] = 0;
      for (int i = 0; i <= 400; i++) norm[k] = std::max(norm[k], std::fabs(besselJ(modes[k].m, (modes[k].j * i) / 400)));
    }
    double *s = tun[0], *mem = tun[1], *pl = tun[2], *bell = tun[3], *bowl = tun[4], *hang = tun[5], *mar = tun[6], *kal = tun[7];
    for (int k = 0; k < 8; k++) for (int i = 0; i < NM; i++) tun[k][i] = 0;
    for (int k = 0; k < NM; k++) { s[k] = k + 1; mem[k] = modes[k].j / modes[0].j; pl[k] = mem[k] * mem[k]; }
    const double bl[5] = {0.5, 1, 1.2, 1.5, 2};
    for (int k = 0; k < 5; k++) bell[k] = bl[k];
    for (int k = 5; k < NM; k++) bell[k] = (pl[k] * 2.5) / pl[5];
    // поющая чаша: моды парами, чуть врозь (+0.4 %) — долгий звон с биениями
    const double BW[12] = {1, 2.71, 5.15, 8.43, 12.5, 17.4, 23.1, 29.6, 36.9, 45.0, 54.0, 63.8};
    for (int k = 0; k < NM; k++) bowl[k] = BW[k >> 1] * (k & 1 ? 1.004 : 1);
    // ханг: настроенные основной, октава и квинта через октаву; выше — как у пластины
    for (int k = 0; k < 3; k++) hang[k] = k + 1;
    for (int k = 3; k < NM; k++) hang[k] = (pl[k] * 4) / pl[3];
    // брусок со свободными концами: β_n — корни cos·ch = 1; маримба настроена 1 : 4 : 10, выше — как брусок
    const auto ff = [](int n) { return n == 1 ? 4.7300 : n == 2 ? 7.8532 : ((2 * n + 1) * PI) / 2; };
    const double mr[3] = {1, 4, 10};
    for (int k = 0; k < 3; k++) mar[k] = mr[k];
    const double a3 = ff(3) / ff(1);
    for (int k = 3; k < NM; k++) { const double a = ff(k + 1) / ff(1); mar[k] = ((a * a) * 10) / (a3 * a3); }
    // калимба — язычок, закреплённый с одного конца: β_n — корни cos·ch = −1, обертоны далеко и неровно
    const auto cf = [](int n) { return n == 1 ? 1.8751 : n == 2 ? 4.6941 : n == 3 ? 7.8548 : ((2 * n - 1) * PI) / 2; };
    for (int k = 0; k < NM; k++) { const double a = cf(k + 1) / cf(1); kal[k] = a * a; }
  }
};
const Tables& tables() { static const Tables t; return t; }

// отношения частот мод: structure 0..1 — по телам через 1/7, между соседними — интерполяция в логарифме
void modeRatios(double structure, double* r) {
  const Tables& T = tables();
  const int n = 7;
  const double x = clamp01(structure) * n;
  const int seg = std::min(n - 1, static_cast<int>(std::floor(x)));
  const double t = x - seg;
  for (int k = 0; k < NM; k++) { const double A = T.tun[seg][k], B = T.tun[seg + 1][k]; r[k] = A * std::pow(B / A, t); }
}

// затухание: damping — общая длина (0.08–12 с), brightness — насколько дольше живёт верх
void t60s(const double* ratios, double damping, double brightness, double* out) {
  const double T = lerpLog(0.08, 12, clamp01(damping)), e = 2 * (1 - clamp01(brightness));
  for (int k = 0; k < NM; k++) out[k] = T * std::pow(1 / ratios[k], e);
}

// трение смычка по разности скоростей смычка и пластины (кривая как у bowed-string), нормировано на покой
double bowTable(double d) { return std::min(1.0, std::pow(std::fabs(d) * 5 + 0.75, -4.0)); }

}  // namespace

void Plate::prepare(double sr, uint32_t seed) {
  fs_ = sr > 0 ? sr : 48000;
  tables();                                              // таблицы мод считаются один раз, до звука
  f0_ = 110; lp_ = 0; lastLive_ = -1e12;
  structure_ = 0.66; damping_ = 0.5; brightness_ = 0.5;
  for (Voice& v : v_) { v = Voice(); }
  nStrikes_ = 0; nBows_ = 0; nEv_ = 0;
  count_ = 0; every_ = static_cast<int>(sdk::jsRound(fs_ / 30));
  enA_ = 1 - std::exp(-1 / (0.05 * fs_));
  for (double& e : energy_) e = 0;
  clock_.prepare(fs_);
  rng_ = sdk::Rng(seed);
  chance_ = 1; rlen_ = 16; mlen_ = 7; r_ = -1; m_ = -1;
  for (RStep& s : rhythm_) s = RStep();
  for (MStep& s : melody_) s = MStep();
  retune();
}

void Plate::retune() {
  modeRatios(structure_, ratios_);
  t60s(ratios_, damping_, brightness_, t60_);
  for (Voice& v : v_) tune(v, v.hz);
}

// коэффициенты голоса: усиление удара — sin ω (импульс даёт амплитуду ~1), смычка — ещё ·√(1−R²) (шум даёт ~1) и спад по модам
void Plate::tune(Voice& v, double hz) {
  v.hz = hz;
  for (int k = 0; k < NM; k++) {
    const double f = hz * ratios_[k];
    if (f > 18000 || f > 0.45 * fs_) { v.coef[k] = {0, 0}; v.gs[k] = 0; v.wb[k] = 0; v.res[k].reset(); continue; }
    const sdk::ResCoef c = sdk::ResCoef::t60(f, t60_[k], fs_);
    const double s = std::sin((2 * PI * f) / fs_);
    // смычок и дыхание — шум: без спада по модам верх режет уши; вес ratio^−1.5, как у настоящего смычка
    v.coef[k] = c; v.gs[k] = s; v.wb[k] = std::sqrt(1 + c.b2) * std::pow(ratios_[k], -BOW_TILT);
  }
}

void Plate::strikeGains(double x, double y, double* g) const {
  const Tables& T = tables();
  const double r = std::hypot(x, y);
  for (int k = 0; k < NM; k++) {
    if (r > 1) { g[k] = 0; continue; }
    const Mode& d = T.modes[k];
    g[k] = std::fabs((besselJ(d.m, d.j * r) * std::cos(d.m * std::atan2(y, x))) / T.norm[k]);
  }
}

// голос для ноты: тот же (±10 центов), иначе самый тихий
int Plate::pickVoice(double hz) const {
  for (int i = 0; i < NV; i++) if (std::fabs(1200 * std::log2(v_[i].hz / hz)) < 10) return i;
  int best = 0;
  for (int i = 1; i < NV; i++) if (v_[i].level < v_[best].level) best = i;
  return best;
}

void Plate::doStrike(const double* g, double hz, double vel, double hard) {
  const int i = pickVoice(hz);
  Voice& v = v_[i];
  if (std::fabs(1200 * std::log2(v.hz / hz)) >= 10) tune(v, hz);
  // длина импульса — твёрдость молоточка, но не дольше 0.4 периода основного тона: иначе удар гасит сам себя
  const int len = static_cast<int>(std::max(2.0, sdk::jsRound(std::min(((5 - 4.5 * clamp01(hard)) * fs_) / 1000, (0.4 * fs_) / hz))));
  v.awake = true;
  if (nStrikes_ >= MAX_STRIKES) { std::memmove(strikes_, strikes_ + 1, sizeof(Strike) * (MAX_STRIKES - 1)); nStrikes_--; }
  Strike& s = strikes_[nStrikes_++];
  s.v = i; s.n = 0; s.len = len; s.a = vel;
  std::memcpy(s.g, g, sizeof(s.g));
}

void Plate::params(double structure, double damping, double brightness) {
  if (!std::isnan(structure)) structure_ = structure;
  if (!std::isnan(damping)) damping_ = damping;
  if (!std::isnan(brightness)) brightness_ = brightness;
  retune();
}

void Plate::f0(double hz) { f0_ = std::min(880.0, std::max(55.0, hz)); }

void Plate::strike(double x, double y, double hz, double vel, double hard, bool rec) {
  if (rec) lastLive_ = static_cast<double>(clock_.t());   // удар при записи: ближайший тик ритма его не повторит (без записи — играешь поверх)
  double g[NM];
  strikeGains(x, y, g);
  doStrike(g, (std::isnan(hz) || hz == 0) ? f0_ : hz, std::isnan(vel) ? 1 : vel, std::isnan(hard) ? 0.5 : hard);
}

// новый узор: веса мод — заново только у шагов, чьё место изменилось (тянешь темп или длину — в звуковом потоке ничего тяжёлого)
void Plate::seq(const double* a, int n) {
  if (!a || n < SEQ_N) return;
  const auto def = [](double v, double d) { return std::isnan(v) ? d : v; };
  chance_ = def(a[2], 1);
  rlen_ = static_cast<int>(a[3]); mlen_ = static_cast<int>(a[4]);
  if (rlen_ < 1) rlen_ = 1;
  if (mlen_ < 1) mlen_ = 1;
  if (rlen_ > SLOTS) rlen_ = SLOTS;
  if (mlen_ > SLOTS) mlen_ = SLOTS;
  const double* p = a + 5;
  for (int i = 0; i < SLOTS; i++, p += 3) {
    RStep& s = rhythm_[i];
    s.on = p[0] != 0; s.vel = def(p[1], 1); s.chance = def(p[2], 1);
  }
  for (int i = 0; i < SLOTS; i++, p += 4) {
    MStep& s = melody_[i];
    if (p[0] == 0) { s.on = false; continue; }
    const bool same = s.on && s.x == p[2] && s.y == p[3];
    s.on = true; s.s = p[1];
    if (!same) { s.x = p[2]; s.y = p[3]; strikeGains(s.x, s.y, s.g); }
  }
  if (clock_.set(a[1] != 0, a[0])) { r_ = -1; m_ = -1; }
}

void Plate::lock(bool off, double t0, double p) { clock_.lock(off, t0, p); }

void Plate::bow(int id, bool on, double x, double y, double exciter, double pressure, double amp) {
  int at = -1;
  for (int i = 0; i < nBows_; i++) if (bows_[i].id == id) { at = i; break; }
  if (!on) {
    if (at >= 0) { for (int i = at; i + 1 < nBows_; i++) bows_[i] = bows_[i + 1]; nBows_--; }
    return;
  }
  const bool fresh = at < 0;
  if (fresh) {
    if (nBows_ >= MAX_BOWS) return;
    at = nBows_++;
    bows_[at].id = id; bows_[at].x = 0; bows_[at].y = 0; bows_[at].exciter = 0; bows_[at].pressure = 0.5; bows_[at].amp = 1;
  }
  Bow& b = bows_[at];
  if (!std::isnan(x)) b.x = x;
  if (!std::isnan(y)) b.y = y;
  if (!std::isnan(exciter)) b.exciter = exciter;
  if (!std::isnan(pressure)) b.pressure = pressure;
  if (!std::isnan(amp)) b.amp = amp;
  if (fresh || !std::isnan(x) || !std::isnan(y)) strikeGains(b.x, b.y, b.g);
}

void Plate::tick() {
  r_ = (r_ + 1) % rlen_;
  m_ = (m_ + 1) % mlen_;
  const RStep& st0 = rhythm_[r_];
  const bool hit = st0.on && rng_.next() < st0.chance * chance_;   // шанс удара: свой у шага × общий
  if (nEv_ < HEARD_CAP) ev_[nEv_++] = {r_, m_, static_cast<double>(clock_.t()) / fs_, hit};
  const MStep& mel = melody_[m_];
  if (!hit || !mel.on || static_cast<double>(clock_.t()) - lastLive_ < static_cast<double>(clock_.stepN()) / 2) return;   // шаг мелодии без места — пауза
  doStrike(mel.g, F_LO * std::pow(2.0, mel.s / 12), st0.vel, 0.5);
}

void Plate::process(float* L, float* R, int N) {
  clock_.begin();
  // смычки звучат на текущей высоте: голос этой ноты (или самый тихий, перестроенный)
  int bi = -1;
  if (nBows_) {
    bi = pickVoice(f0_);
    Voice& bv = v_[bi];
    if (std::fabs(1200 * std::log2(bv.hz / f0_)) >= 10) tune(bv, f0_);
    bv.awake = true;
  }
  bool asleep = true;
  for (const Voice& v : v_) if (v.awake) asleep = false;
  if (!clock_.playing() && nStrikes_ == 0 && bi < 0 && asleep) {   // тишина: не считаем, выход — нули
    for (int n = 0; n < N; n++) { L[n] = 0; R[n] = 0; }
    count_ += N; clock_.skip(N);
    if (count_ >= every_) { count_ = 0; report(); }
    return;
  }
  const sdk::Knee out;                                   // до 0.8 — прямая (удар звенит чисто), выше — мягко к 1.6
  for (int n = 0; n < N; n++, clock_.advance()) {
    if (clock_.due()) { tick(); clock_.rearm(n); }
    for (Voice& v : v_) for (int k = 0; k < NM; k++) v.x[k] = 0;
    // удары: полукосинус единичной площади, длина — твёрдость молоточка
    for (int s = nStrikes_ - 1; s >= 0; s--) {
      Strike& st = strikes_[s];
      const double p = (st.a * (1 - std::cos((2 * PI * st.n) / st.len))) / st.len;
      double* x = v_[st.v].x;
      for (int k = 0; k < NM; k++) x[k] += st.g[k] * p * STRIKE_GAIN;
      if (++st.n >= st.len) { for (int i = s; i + 1 < nStrikes_; i++) strikes_[i] = strikes_[i + 1]; nStrikes_--; }
    }
    if (bi >= 0) {
      Voice& v = v_[bi];
      lp_ += 0.1 * (rng_.next() * 2 - 1 - lp_);          // шум для возбудителя «дыхание»
      for (int bn = 0; bn < nBows_; bn++) {
        const Bow& b = bows_[bn];
        double vp = 0;                                    // скорость пластины в точке смычка
        for (int k = 0; k < NM; k++) vp += b.g[k] * (v.res[k].y1 - v.res[k].y2);
        const double vb = 0.25, fric = bowTable(vb - vp) / bowTable(vb);
        const double bow = (rng_.next() * 2 - 1) * fric, breath = lp_ * 3;
        const double e = ((1 - b.exciter) * bow + b.exciter * breath) * b.amp * (0.5 + b.pressure) * BOW_GAIN;
        for (int k = 0; k < NM; k++) v.x[k] += b.g[k] * e * v.wb[k];
      }
    }
    double l = 0, r = 0;
    for (Voice& v : v_) {
      if (!v.awake) continue;
      for (int k = 0; k < NM; k++) {
        const double y = v.res[k].step(v.coef[k], v.gs[k], v.x[k]);
        v.en[k] += (y * y - v.en[k]) * enA_;
        if (k & 1) { l += 0.65 * y; r += 0.35 * y; } else { l += 0.35 * y; r += 0.65 * y; }   // моды разведены по чётности
      }
    }
    L[n] = static_cast<float>(out(l * OUT_GAIN));
    R[n] = static_cast<float>(out(r * OUT_GAIN));
    if (++count_ >= every_) { count_ = 0; report(); }
  }
  // голос без ударов и смычков, отзвеневший до тишины, засыпает: состояние в ноль, дальше не считается
  for (int i = 0; i < NV; i++) {
    Voice& v = v_[i];
    bool struck = false;
    for (int s = 0; s < nStrikes_; s++) if (strikes_[s].v == i) struck = true;
    if (!v.awake || i == bi || struck) continue;
    double e = 0;
    for (int k = 0; k < NM; k++) e += v.en[k];
    if (e < SLEEP) { v.awake = false; for (int k = 0; k < NM; k++) { v.res[k].reset(); v.en[k] = 0; } }
  }
}

// ~30 раз в секунду: энергии мод (сумма по голосам) и уровни голосов — по ним резонатор и выбор тихого голоса
void Plate::report() {
  for (double& e : energy_) e = 0;
  for (Voice& v : v_) {
    double lv = 0;
    for (int k = 0; k < NM; k++) { energy_[k] += v.en[k]; lv += v.en[k]; }
    v.level = lv;
  }
}

bool Plate::sounding() const {
  if (clock_.playing() || nStrikes_ > 0 || nBows_ > 0) return true;
  for (const Voice& v : v_) if (v.awake) return true;
  return false;
}

int Plate::events(StepEvent* out, int cap) {
  const int n = std::min(nEv_, cap);
  for (int i = 0; i < n; i++) out[i] = ev_[i];
  nEv_ = 0;
  return n;
}

}  // namespace cymatica
