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
  std::memset(master_, 0, sizeof master_);
  
  // Мастер-цепь
  for (auto& f : lpf_) f.set(sdk::Biquad::lowpass, 20000, 0.5, sr);
  compThr_ = -10; compRatio_ = 2.5;
  compEnv_[0] = compEnv_[1] = 0;
  knee_.k = 2.6 / std::tanh(2.6);
  knee_.kn = 0.6;
  knee_.room = 0.38;
  masterGain_ = 1.0;
  
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
  
  // Мастер-цепь: LPF → компрессор → потолок knee
  for (int c = 0; c < 2; c++) {
    for (int i = 0; i < n; i++) master_[c][i] = static_cast<float>(lpf_[c].step(ret_[c][i]));
    for (int i = 0; i < n; i++) {
      const double x = std::abs(master_[c][i]);
      const double attack = 0.01, release = 0.4;        // время атаки/релиза (с)
      const double a = x > compEnv_[c] ? (1.0 - std::exp(-1.0 / (attack * clk_.sr))) : (1.0 - std::exp(-1.0 / (release * clk_.sr)));
      compEnv_[c] += a * (x - compEnv_[c]);
      const double thrLin = std::pow(10.0, compThr_ / 20.0);
      const double knee = 10.0;                         // ширина колена (дБ)
      double gr = 1.0;                                  // gain reduction
      if (compEnv_[c] > thrLin) {
        const double dbOver = 20.0 * std::log10(compEnv_[c] / thrLin);
        if (dbOver < knee) {
          const double s = 1.0 / compRatio_ - 1.0;
          gr = std::pow(10.0, s * dbOver * dbOver / (2.0 * knee) / 20.0);
        } else {
          gr = std::pow(10.0, (1.0 / compRatio_ - 1.0) * (dbOver - knee / 2.0) / 20.0);
        }
      }
      master_[c][i] = static_cast<float>(master_[c][i] * gr);
    }
    for (int i = 0; i < n; i++) master_[c][i] = static_cast<float>(knee_(master_[c][i]) * masterGain_);
  }
  
  std::memset(ext_, 0, sizeof ext_);
  clk_.now += n / clk_.sr;                              // следующий блок — сразу за этим (веб перед каждым задаёт время сам)
}

void Host::masterLpf(double hz) {
  const double sr = clk_.sr;
  const double cutoff = hz > 19000 ? 22000 : hz;        // >19 кГц — проброс (22 кГц)
  for (auto& f : lpf_) f.set(sdk::Biquad::lowpass, cutoff, 0.5, sr);
}

void Host::masterComp(double thr, double ratio) {
  compThr_ = thr;
  compRatio_ = ratio;
}

void Host::masterCeil(double db) {
  const double room = (db + 12.0) / 12.0;               // −12…0 дБ → 0…1
  knee_.k = 2.6 / std::tanh(2.6);
  knee_.kn = 0.6;
  knee_.room = 0.38 * (room > 0 ? (room < 1 ? room : 1) : 0);
  masterGain_ = std::pow(10.0, -db / 20.0);             // компенсация потолка усилением
}

const float* Host::master(int ch) const { return master_[ch & 1]; }

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
