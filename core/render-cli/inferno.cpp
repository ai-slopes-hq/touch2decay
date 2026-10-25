// Нативный рендер Inferno для сверки с прежним JS (tools/inferno-compare.py): читает сценарий (строки «fx structure 0.5», «pin 5 0.3»,
// «hold 4», «strike 8 1», «pos k v», «circ k width 0.3»), считает блоками по 128, пишет float32 [сухой, посыл] попарно.
//   clang++ -std=c++17 -O2 -ffp-contract=off core/render-cli/inferno.cpp core/worlds/inferno/*.cpp core/host/scale.cpp -o inferno-render
//   inferno-render scenario.txt secs out.f32 [seed]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "../worlds/inferno/world.hpp"

int main(int argc, char** argv) {
  if (argc < 4) { std::fprintf(stderr, "usage: inferno-render scenario secs out.f32 [seed]\n"); return 2; }
  const double sr = 48000, secs = std::atof(argv[2]);
  Scale sc;
  inferno::Inferno w(sc);
  w.prepare(sr, argc > 4 ? static_cast<uint32_t>(std::atoi(argv[4])) : 1);
  static const char* fxn[] = {"structure", "fire", "smoke", "ice", "storm"};
  static const char* ck[] = {"pos", "width", "drive", "level", "color"};
  const auto idx = [](const char* const* a, int n, const std::string& s) { for (int i = 0; i < n; i++) if (s == a[i]) return i; return -1; };
  std::ifstream f(argv[1]);
  std::string line;
  while (std::getline(f, line)) {
    std::istringstream is(line);
    std::string op, a;
    double x = 0, y = 0;
    is >> op;
    if (op == "fx") { is >> a >> x; const double v[1] = {x}; w.action(inferno::ACT_FX, idx(fxn, 5, a), v, 1); }
    else if (op == "strike") { int k; is >> k >> x; const double v[1] = {x}; w.action(inferno::ACT_STRIKE, k, v, 1); }
    else if (op == "pin") { int k; is >> k >> x; const double v[1] = {x}; w.action(inferno::ACT_PIN, k, v, 1); }
    else if (op == "hold") { int k; is >> k; const double v[1] = {1}; w.action(inferno::ACT_HOLD, k, v, 1); }
    else if (op == "pos") { int k; is >> k >> x; const double v[1] = {x}; w.action(inferno::ACT_POS, k, v, 1); }
    else if (op == "circ") { int k; is >> k >> a >> y; const double v[2] = {static_cast<double>(idx(ck, 5, a)), y}; w.action(inferno::ACT_CIRC, k, v, 2); }
  }
  std::vector<float> out;
  static float L[128], R[128], sL[128], sR[128];
  const sdk::Out o{L, R, sL, sR};
  for (int b = 0; b < static_cast<int>(secs * sr / 128); b++) {
    w.process(o, 128);
    for (int i = 0; i < 128; i++) { out.push_back(L[i]); out.push_back(sL[i]); }
  }
  std::FILE* fo = std::fopen(argv[3], "wb");
  std::fwrite(out.data(), sizeof(float), out.size(), fo);
  std::fclose(fo);
  return 0;
}
