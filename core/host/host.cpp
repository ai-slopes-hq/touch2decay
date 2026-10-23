// Хост SDK: см. host.hpp. Порядок process: миры → посыл × фейдер в rin → (+ ext) → защита от NaN → ревербы → сумма × 0.9.
#include "host.hpp"
#include <cmath>
#include <cstring>

using sdk::Rev;

static const Rev kTypes[4] = {Rev::room, Rev::plate, Rev::hall, Rev::cathedral};
static int ix(Rev r) { return static_cast<int>(r); }

void Host::prepare(double sr, uint32_t seed) {
  for (int i = 0; i < 4; i++) rev_[i].prepare(sr, kTypes[i], seed + static_cast<uint32_t>(i));
  for (int s = 0; s < SLOTS; s++) std::memset(dry_[s], 0, sizeof dry_[s]);
  std::memset(ext_, 0, sizeof ext_);
  std::memset(ret_, 0, sizeof ret_);
}

void Host::add(int slot, sdk::World* w) {
  if (slot < 0 || slot >= SLOTS) return;
  w_[slot] = w;
  gain_[slot] = w ? 1.f : 0.f;
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
}
