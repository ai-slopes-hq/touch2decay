// Полный микс ядра (api.cpp: хост + все миры) → float32: действия со stdin, затем секунды; stdout — кадры по 4 канала
// (сумма L, R до мастера; микс L, R после мастера) для сверки мастера с цепочкой Web Audio (tools/master-bus.py). Блоки по 128, 48 кГц.
// Строки stdin: "secs 6", "seed 1", "act <время с> <слот> <вид> <i> [a …]" — действие мира слота в заданное время (в порядке строк).
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../bridge/t2d.h"

struct Act { double t; int slot, kind, i; std::vector<double> a; };

int main() {
  double secs = 6;
  unsigned seed = 1;
  std::vector<Act> acts;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    s >> k;
    if (k == "secs") s >> secs;
    else if (k == "seed") s >> seed;
    else if (k == "act") { Act a{}; s >> a.t >> a.slot >> a.kind >> a.i; double v; while (s >> v) a.a.push_back(v); acts.push_back(a); }
  }
  t2d_init(48000, seed);
  float sL[128], sR[128], mL[128], mR[128];
  const long blocks = static_cast<long>(secs * 48000 / 128);
  std::vector<float> buf(4 * 128);
  size_t next = 0;
  double now = 0;
  for (long b = 0; b < blocks; b++) {
    while (next < acts.size() && acts[next].t <= now + 1e-9) {
      const Act& a = acts[next++];
      t2d_action(a.slot, a.kind, a.i, a.a.data(), static_cast<int>(a.a.size()));
    }
    t2d_process(128);
    t2d_sum(sL, sR, 128);
    for (int k = 0; k < 128; k++) { mL[k] = sL[k]; mR[k] = sR[k]; }
    t2d_master_run(mL, mR, 128);
    now += 128 / 48000.0;
    for (int k = 0; k < 128; k++) { buf[4 * k] = sL[k]; buf[4 * k + 1] = sR[k]; buf[4 * k + 2] = mL[k]; buf[4 * k + 3] = mR[k]; }
    std::fwrite(buf.data(), sizeof(float), buf.size(), stdout);
  }
  return 0;
}
