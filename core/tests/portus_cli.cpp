// Portus (мир SDK) → float32: снимок сцены (JSON модели) со stdin, затем секунды; stdout — кадры по 4 канала (L, R, посыл L, посыл R) для сверки
// с прежним Web Audio-движком в Chromium (tools/portus-bus.py) и с t2d.wasm (tools/test-portus-core.mjs). Часы — своего темпа (без сетки), зерно 1.
// Строки stdin: "snapshot {json}" (restore модели), "secs 6"; остальное — по умолчанию мира.
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../host/scale.hpp"
#include "../worlds/portus/world.hpp"

int main() {
  std::string snap;
  double secs = 6;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    s >> k;
    if (k == "snapshot") { std::getline(s, snap); }
    else if (k == "secs") s >> secs;
  }
  if (snap.empty()) { std::fprintf(stderr, "snapshot: no scene\n"); return 1; }
  Scale sc;
  portus::World w(sc);
  w.prepare(48000, 1);
  sdk::Clock clk; clk.sr = 48000; w.attach(&clk);
  w.restore(snap);
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
