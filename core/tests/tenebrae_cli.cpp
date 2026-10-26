// Tenebrae (мир SDK, слот 1) → float32: действия со stdin, затем секунды; stdout — кадры по 4 канала (L, R, посыл L, посыл R) для сверки
// с прежним Web Audio-движком в Chromium (tools/tenebrae-bus.py) и с t2d.wasm (tools/test-tenebrae-core.mjs). Зерно по умолчанию 1, блоки по 128.
// Строки stdin: "scale on idx root", "secs 6", "seed 1" (зерно мира: сверка с эталоном усредняет по нескольким),
// "act <время с> <вид> <i> [a …]" — действие мира в заданное время (в порядке строк; виды — enum Act в core/worlds/tenebrae/world.hpp).
// Флаг --time — в stderr множитель реального времени (секунды звука / секунды счёта).
#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../host/scale.hpp"
#include "../worlds/tenebrae/world.hpp"

struct Act { double t; int kind, i; std::vector<double> a; };

int main(int argc, char** argv) {
  const bool timing = argc > 1 && std::strcmp(argv[1], "--time") == 0;
  double secs = 6;
  unsigned seed = 1;
  std::vector<Act> acts;
  Scale sc;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    s >> k;
    if (k == "secs") s >> secs;
    else if (k == "seed") s >> seed;
    else if (k == "scale") { int on = 0, idx = 0, root = 0; s >> on >> idx >> root; sc.on = on != 0; sc.idx = idx; sc.root = root; }
    else if (k == "act") { Act a{}; s >> a.t >> a.kind >> a.i; double v; while (s >> v) a.a.push_back(v); acts.push_back(a); }
  }
  static tenebrae::World w(sc);                          // таблицы ~0.95 МБ — не на стек
  w.prepare(48000, seed);
  float L[128], R[128], sL[128], sR[128];
  const sdk::Out out{L, R, sL, sR};
  const long blocks = static_cast<long>(secs * 48000 / 128);
  std::vector<float> buf(4 * 128);
  size_t next = 0;
  double now = 0, busy = 0;
  for (long b = 0; b < blocks; b++) {
    const auto t0 = std::chrono::steady_clock::now();
    while (next < acts.size() && acts[next].t <= now + 1e-9) {
      const Act& a = acts[next++];
      w.action(a.kind, a.i, a.a.data(), static_cast<int>(a.a.size()));
    }
    w.process(out, 128);
    busy += std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    now += 128 / 48000.0;
    for (int k = 0; k < 128; k++) { buf[4 * k] = L[k]; buf[4 * k + 1] = R[k]; buf[4 * k + 2] = sL[k]; buf[4 * k + 3] = sR[k]; }
    std::fwrite(buf.data(), sizeof(float), buf.size(), stdout);
  }
  if (timing) std::fprintf(stderr, "realtime x%.1f\n", busy > 0 ? now / busy : 0.0);
  return 0;
}
