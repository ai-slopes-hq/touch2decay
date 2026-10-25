// Portus (мир SDK) → float32: STATE (83 числа) со stdin, затем секунды; stdout — кадры по 4 канала (L, R, посыл L, посыл R) для сверки с
// прежним Web Audio-движком в Chromium (tools/portus-bus.py). Часы — своего темпа (без сетки), зерно 1.
// Строки stdin: "state n0 n1 … n82", "secs 6", "fb 0.5" и т. п. не нужны — всё остальное по умолчанию мира.
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../host/scale.hpp"
#include "../worlds/portus/world.hpp"

int main() {
  std::vector<double> st;
  double secs = 6;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    s >> k;
    if (k == "state") { double v; while (s >> v) st.push_back(v); }
    else if (k == "secs") s >> secs;
  }
  if (st.size() != static_cast<size_t>(portus::STATE_N)) { std::fprintf(stderr, "state: %zu numbers, want %d\n", st.size(), portus::STATE_N); return 1; }
  Scale sc;
  portus::World w(sc);
  w.prepare(48000, 1);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  w.action(portus::STATE, 0, st.data(), static_cast<int>(st.size()));
  const double on[1] = {1};
  w.action(portus::PLAY, 0, on, 1);
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const long blocks = static_cast<long>(secs * 48000 / 128);
  std::vector<float> buf(4 * 128);
  for (long b = 0; b < blocks; b++) {
    w.process(out, 128);
    clk.now += 128 / 48000.0;
    for (int k = 0; k < 128; k++) { buf[4 * k] = L[k]; buf[4 * k + 1] = R[k]; buf[4 * k + 2] = sL[k]; buf[4 * k + 3] = sR[k]; }
    std::fwrite(buf.data(), sizeof(float), buf.size(), stdout);
  }
  return 0;
}
