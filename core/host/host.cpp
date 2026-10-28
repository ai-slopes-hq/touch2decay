#include "host.hpp"
#include <cmath>
#include <cstring>

using sdk::Rev;

static const Rev kTypes[4] = {Rev::room, Rev::plate, Rev::hall, Rev::cathedral};
static int ix(Rev r) { return static_cast<int>(r); }

void Host::prepare(double sr, uint32_t seed) {
  clk_ = sdk::Clock{}; clk_.sr = sr > 0 ? sr : 48000;
  for (auto& p : parse_) p = sdk::ClockParser();
  follow_ = sdk::Follower(); nev_ = 0;
  for (int i = 0; i < 4; i++) rev_[i].prepare(sr, kTypes[i], seed + static_cast<uint32_t>(i));
  for (int s = 0; s < SLOTS; s++) std::memset(dry_[s], 0, sizeof dry_[s]);
  std::memset(ext_, 0, sizeof ext_);
  std::memset(ret_, 0, sizeof ret_);
  
  // Мастер-цепь (по умолчанию как MIX_DEF веба: LPF 22 кГц, компрессор −10/10/2.5, потолок 0 дБ)
  for (auto& f : hp_) f.set(sdk::Biquad::highpass, 30, 1, clk_.sr);
  masterLpf(22000);                                     // срез прежней сцены не переживает t2d_init
  for (auto& f : lpf_) { f.x1 = f.x2 = f.y1 = f.y2 = 0; }
  for (auto& f : hp_) { f.x1 = f.x2 = f.y1 = f.y2 = 0; }
  comp_.set(-10, 2.5, clk_.sr);
  comp_.reset();
  const sdk::Knee kn{2.6 / std::tanh(2.6), 0.6, 0.98 - 0.6};
  knee_.curve.build([&kn](double x) { return kn(x); });
  knee_.os = 4;
  knee_.reset();
  ceilGain_ = 1.0;

  // LFO
  lfos_.clear();
  morphClassic_ = sdk::WaveMorph(sdk::WaveMorph::CLASSIC);
  morphRandom_ = sdk::WaveMorph(sdk::WaveMorph::RANDOM);
}

void Host::add(int slot, sdk::World* w) {
  if (slot < 0 || slot >= SLOTS) return;
  w_[slot] = w;
  gain_[slot] = w ? 1.f : 0.f;
  if (w) w->attach(&clk_);
}

void Host::follow(const sdk::MidiMsg& m, double at) {
  int ev[2]; double bpm;
  const int k = follow_.message(m, at, clk_.now, ev, &bpm);
  for (int i = 0; i < k; i++) {
    if (nev_ == EVMAX) { for (int j = 1; j < EVMAX; j++) { ev_[j - 1][0] = ev_[j][0]; ev_[j - 1][1] = ev_[j][1]; } nev_--; }   // старое уходит
    ev_[nev_][0] = ev[i]; ev_[nev_][1] = bpm; nev_++;
  }
  clk_.grid = follow_.grid();
}

void Host::midiByte(int src, int status, double at) {
  if (status < 0xF8) return;                            // только системные реального времени
  const sdk::MidiMsg m = parse_[(src % SRC + SRC) % SRC].byte(status, at);
  if (m.t != sdk::MidiMsg::NONE) follow(m, at);
}

void Host::midiMsg(int kind, double n, double bpm, double at) {
  sdk::MidiMsg m;
  m.t = static_cast<sdk::MidiMsg::Type>(kind < 0 || kind > 4 ? 0 : kind); m.n = n; m.bpm = bpm;
  if (m.t != sdk::MidiMsg::NONE) follow(m, at);
}

int Host::events(double* buf, int cap) {
  int k = 0;
  for (int i = 0; i < nev_ && k + 2 <= cap; i++) { buf[k++] = ev_[i][0]; buf[k++] = ev_[i][1]; }
  nev_ = 0;
  return k;
}

void Host::action(int slot, int kind, int i, const double* a, int n) {
  if (slot >= 0 && slot < SLOTS && w_[slot]) w_[slot]->action(kind, i, a, n);
}

void Host::fader(int slot, double g) {
  if (slot >= 0 && slot < SLOTS && w_[slot]) gain_[slot] = static_cast<float>(g);
}

void Host::scale(bool on, int idx, int root) {
  scale_.on = on;
  scale_.idx = idx < 0 ? 0 : (idx >= Scale::kScales ? Scale::kScales - 1 : idx);
  scale_.root = ((root % 12) + 12) % 12;
}

float* Host::ext(Rev r, int ch) { return ext_[ix(r)][ch & 1]; }

const float* Host::dry(int slot, int ch) const {
  return dry_[(slot < 0 || slot >= SLOTS) ? 0 : slot][ch & 1];
}

const float* Host::ret(int ch) const { return ret_[ch & 1]; }

void Host::process(int n) {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  follow_.tick(clk_.now);                               // часы пропали (1 с без долей) — сетки нет
  clk_.grid = follow_.grid();
  const size_t bytes = sizeof(float) * static_cast<size_t>(n);
  for (int r = 0; r < 4; r++) for (int c = 0; c < 2; c++) std::memcpy(rin_[r][c], ext_[r][c], bytes);   // внешние посылы — основа суммы
  for (int s = 0; s < SLOTS; s++) {
    if (!w_[s]) { std::memset(dry_[s], 0, sizeof dry_[s]); continue; }
    const sdk::Out out{dry_[s][0], dry_[s][1], sendL_, sendR_};
    w_[s]->process(out, n);
    const int r = ix(w_[s]->rev());
    const float g = gain_[s];                           // посыл после фейдера: заглушил мир — хвост дозвучит
    for (int i = 0; i < n; i++) { rin_[r][0][i] += sendL_[i] * g; rin_[r][1][i] += sendR_[i] * g; }
  }
  for (int r = 0; r < 4; r++) {
    for (int c = 0; c < 2; c++)                         // NaN/inf в входе навсегда отравил бы состояние ревербера
      for (int i = 0; i < n; i++) if (!std::isfinite(rin_[r][c][i])) rin_[r][c][i] = 0.f;
    rev_[r].process(rin_[r][0], rin_[r][1], rout_[r][0], rout_[r][1], n);
  }
  for (int c = 0; c < 2; c++)
    for (int i = 0; i < n; i++) ret_[c][i] = (rout_[0][c][i] + rout_[1][c][i] + rout_[2][c][i] + rout_[3][c][i]) * RET;

  std::memset(ext_, 0, sizeof ext_);
  clk_.now += n / clk_.sr;                              // следующий блок — сразу за этим (веб перед каждым задаёт время сам)
}

void Host::sum(float* L, float* R, int n) const {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  for (int i = 0; i < n; i++) { L[i] = ret_[0][i]; R[i] = ret_[1][i]; }
  for (int s = 0; s < SLOTS; s++) {
    if (!w_[s]) continue;
    const float g = gain_[s] * static_cast<float>(w_[s]->trim());
    for (int i = 0; i < n; i++) { L[i] += dry_[s][0][i] * g; R[i] += dry_[s][1][i] * g; }
  }
}

void Host::masterRun(float* L, float* R, int n) {
  if (n > BLOCK) n = BLOCK;
  if (n < 0) n = 0;
  const double amp = 0.8 * VOL_GAIN * 0.5;              // masterG веба и limitIn
  for (int i = 0; i < n; i++) {
    double l = L[i], r = R[i];
    if (!std::isfinite(l)) l = 0;                       // NaN отравил бы состояние фильтров навсегда
    if (!std::isfinite(r)) r = 0;
    l = lpf_[0].step(hp_[0].step(l));
    r = lpf_[1].step(hp_[1].step(r));
    comp_.run(l, r);
    l *= amp; r *= amp;
    knee_.run(l, r);
    L[i] = static_cast<float>(l * ceilGain_);
    R[i] = static_cast<float>(r * ceilGain_);
  }
}

void Host::masterLpf(double hz) {
  const double sr = clk_.sr, top = 0.45 * sr;
  const double cutoff = hz > top ? top : (hz < 10 ? 10 : hz);   // 22 кГц на 44.1 кГц — это Найквист
  for (auto& f : lpf_) f.set(sdk::Biquad::lowpass, cutoff, 0.5, sr);
}

void Host::masterComp(double thr, double ratio) { comp_.set(thr, ratio, clk_.sr); }

void Host::masterCeil(double db) {
  const double d = db > 0 ? 0 : (db < -12 ? -12 : db);
  ceilGain_ = std::pow(10.0, d / 20.0);
}

// Статическая кривая DynamicsCompressorKernel (Chromium): до порога прямая, затем экспоненциальное колено k, выше колена — наклон 1/ratio.
double Host::Comp::kneeCurve(double x, double kk) const { return x < lin ? x : lin + (1 - std::exp(-kk * (x - lin))) / kk; }

double Host::Comp::saturate(double x) const {
  if (x < std::pow(10.0, kneeDb / 20)) return kneeCurve(x, k);
  return std::pow(10.0, (yKneeDb + slope * (20 * std::log10(x) - kneeDb)) / 20);
}

double Host::Comp::slopeAt(double x, double kk) const {
  if (x < lin) return 1;
  const double x2 = x * 1.001, xDb = 20 * std::log10(x), x2Db = 20 * std::log10(x2);
  const double yDb = 20 * std::log10(kneeCurve(x, kk)), y2Db = 20 * std::log10(kneeCurve(x2, kk));
  return (y2Db - yDb) / (x2Db - xDb);
}

void Host::Comp::set(double thr_, double ratio_, double sr) {
  thr = thr_; ratio = ratio_ < 1 ? 1 : ratio_;
  lin = std::pow(10.0, thr / 20);
  slope = 1.0 / ratio;
  kneeDb = thr + knee;
  const double x = std::pow(10.0, kneeDb / 20);
  double lo = 0.1, hi = 10000;                          // k, при котором наклон кривой в колене равен 1/ratio (бисекция, как у Chromium)
  k = 5;
  for (int i = 0; i < 15; i++) {
    if (slopeAt(x, k) < slope) hi = k; else lo = k;
    k = std::sqrt(lo * hi);
  }
  yKneeDb = 20 * std::log10(kneeCurve(x, k));
  makeup = std::pow(1.0 / saturate(1.0), 0.6);          // fullRangeMakeupGain^0.6 — включён всегда, и ниже порога
  aAtt = 1 - std::exp(-1.0 / (att * sr));
  aRel = 1 - std::exp(-1.0 / (rel * sr));
  satRel = 0.0025 * sr;
  dly = static_cast<int>(0.006 * sr + 0.5);
  if (dly > DLY - 1) dly = DLY - 1;
}

void Host::Comp::run(double& l, double& r) {
  const double x = std::fmax(std::fabs(l), std::fabs(r));   // связанный детектор: одно усиление на оба канала
  double att_ = 1;                                      // мгновенное затухание, линейное
  if (x > 1e-4) att_ = saturate(x) / x;
  if (att_ < det) det = att_;                           // детектор Chromium: вниз — сразу, вверх — не медленнее 2 дБ за 2.5 мс
  else {
    const double perFrame = std::fmax(2.0, -20 * std::log10(att_)) / satRel;
    det += (att_ - det) * (std::pow(10.0, perFrame / 20) - 1);
    if (det > 1) det = 1;
  }
  const double target = det < 1 ? 20 * std::log10(det) : 0;   // желаемое усиление, дБ
  if (target < gDb) gDb += aAtt * (target - gDb);       // сжимаем сильнее — атака
  else if (gDb < 0) { gDb += aRel * (target - gDb); if (gDb > 0) gDb = 0; }   // отпускаем — релиз
  buf[0][pos] = static_cast<float>(l); buf[1][pos] = static_cast<float>(r);
  const int rd = (pos - dly + DLY) % DLY;               // сигнал идёт с задержкой, детектор — по входу (lookahead 6 мс)
  const double g = (gDb < -1e-9 ? std::pow(10.0, gDb / 20) : 1.0) * makeup;
  l = buf[0][rd] * g; r = buf[1][rd] * g;
  pos = (pos + 1) % DLY;
}

int Host::addLfo(int world, const char* key, double base, int shape) {
  sdk::RowLfo lfo;
  lfo.world = world;
  lfo.key = key ? key : "";
  lfo.base = base;
  lfo.shape = shape == 1 ? sdk::WaveMorph::RANDOM : sdk::WaveMorph::CLASSIC;
  lfo.morph = lfo.shape == sdk::WaveMorph::CLASSIC ? 0 : 0.6;
  lfo.rate = lfo.shape == sdk::WaveMorph::CLASSIC ? 0.8 : 0.4;
  lfo.depth = 0.3;
  lfo.phase = 0;
  lfo.u = 0;
  lfo.seed = static_cast<int>(lfos_.size() * 1234567 + world * 7919);   // псевдослучайное зерно
  lfos_.push_back(lfo);
  return static_cast<int>(lfos_.size()) - 1;
}

void Host::removeLfo(int idx) {
  if (idx >= 0 && idx < static_cast<int>(lfos_.size())) lfos_.erase(lfos_.begin() + idx);
}

void Host::lfoSpec(int idx, double m0, double m1, double r0, double r1, double d0, double d1) {
  if (idx >= 0 && idx < static_cast<int>(lfos_.size())) {
    auto& lfo = lfos_[static_cast<size_t>(idx)];
    lfo.morph = m0;                                     // начало диапазона morph (конец — m1, но пока не используется)
    lfo.rate = r0;                                      // начало диапазона rate
    lfo.depth = d0;                                     // начало диапазона depth
    // m1, r1, d1 — для будущего (анимация параметров LFO)
    (void)m1; (void)r1; (void)d1;
  }
}

double Host::lfoValue(int idx) const {
  if (idx < 0 || idx >= static_cast<int>(lfos_.size())) return 0.5;
  const auto& lfo = lfos_[static_cast<size_t>(idx)];
  const auto& morph = lfo.shape == sdk::WaveMorph::CLASSIC ? morphClassic_ : morphRandom_;
  return lfo.value(morph);
}

void Host::lfoTick(double dt) {
  for (auto& lfo : lfos_) {
    const auto& morph = lfo.shape == sdk::WaveMorph::CLASSIC ? morphClassic_ : morphRandom_;
    lfo.tick(dt, morph);
  }
}

void Host::modelTick(double dt) {
  const double a[1] = {dt};
  for (int s = 0; s < SLOTS; s++) {
    if (w_[s]) w_[s]->action(-1, 0, a, 1);              // kind=-1 — тик модели
  }
}
