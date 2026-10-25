// Natura (мир SDK) → float32: сцена и действия со stdin, затем секунды; stdout — кадры по 4 канала (L, R, посыл L, посыл R) для сверки
// с прежним Web Audio-движком в Chromium (tools/natura-bus.py) и с t2d.wasm (tools/test-natura-core.mjs). Часы — своего темпа (без сетки), зерно 1.
// Строки stdin: "state n1 … n155" (STATE мира: bpm, len, fx×9, 16 × 9), "scale on idx root", "secs 6",
// "act <время с> <вид> <i> [a …]" — действие мира в заданное время (в порядке строк); остальное — по умолчанию мира.
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../host/scale.hpp"
#include "../worlds/natura/world.hpp"

struct Act { double t; int kind, i; std::vector<double> a; };

int main() {
  double secs = 6;
  std::vector<double> state;
  std::vector<Act> acts;
  Scale sc;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    s >> k;
    if (k == "secs") s >> secs;
    else if (k == "state") { double v; while (s >> v) state.push_back(v); }
    else if (k == "scale") { int on = 0, idx = 0, root = 0; s >> on >> idx >> root; sc.on = on != 0; sc.idx = idx; sc.root = root; }
    else if (k == "act") { Act a{}; s >> a.t >> a.kind >> a.i; double v; while (s >> v) a.a.push_back(v); acts.push_back(a); }
  }
  natura::World w(sc);
  w.prepare(48000, 1);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  if (!state.empty()) w.action(natura::STATE, 0, state.data(), static_cast<int>(state.size()));
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const long blocks = static_cast<long>(secs * 48000 / 128);
  std::vector<float> buf(4 * 128);
  size_t next = 0;
  for (long b = 0; b < blocks; b++) {
    while (next < acts.size() && acts[next].t <= clk.now + 1e-9) {
      const Act& a = acts[next++];
      w.action(a.kind, a.i, a.a.data(), static_cast<int>(a.a.size()));
    }
    w.process(out, 128);
    clk.now += 128 / 48000.0;
    for (int k = 0; k < 128; k++) { buf[4 * k] = L[k]; buf[4 * k + 1] = R[k]; buf[4 * k + 2] = sL[k]; buf[4 * k + 3] = sR[k]; }
    std::fwrite(buf.data(), sizeof(float), buf.size(), stdout);
  }
  return 0;
}
