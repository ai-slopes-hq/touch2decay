// sdk::Param по сценарию (stdin) → float32 значений (stdout), для сверки с AudioParam Chromium (tools/param-check.py).
// Строки: "sr 48000", "len N" (кадров), "def v" (значение по умолчанию), затем события "<вид> B args": вид set|lin|exp v t, target v t tau,
// cancel t; B — номер кванта 128, в начале которого событие ставится (как suspend в OfflineAudioContext); времена — в секундах.
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "../sdk/param.hpp"

struct Op { std::string k; int b; double v, t, tau; };

int main() {
  double sr = 48000, def = 0;
  long len = 0;
  std::vector<Op> ops;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream s(line);
    std::string k;
    if (!(s >> k)) continue;
    if (k == "sr") s >> sr;
    else if (k == "len") s >> len;
    else if (k == "def") s >> def;
    else {
      Op o{k, 0, 0, 0, 0};
      s >> o.b;
      if (k == "cancel") s >> o.t;
      else { s >> o.v >> o.t; if (k == "target") s >> o.tau; }
      ops.push_back(o);
    }
  }
  sdk::Param p(def);
  std::vector<float> out(static_cast<size_t>(len));
  double buf[128];
  for (long f0 = 0, b = 0; f0 < len; f0 += 128, b++) {
    for (const Op& o : ops) {
      if (o.b != b) continue;
      if (o.k == "set") p.set(o.v, o.t * sr);
      else if (o.k == "lin") p.lin(o.v, o.t * sr);
      else if (o.k == "exp") p.exp(o.v, o.t * sr);
      else if (o.k == "target") p.target(o.v, o.t * sr, o.tau * sr);
      else if (o.k == "cancel") p.cancel(o.t * sr);
    }
    const int n = static_cast<int>(len - f0 < 128 ? len - f0 : 128);
    p.fill(buf, n, static_cast<double>(f0));
    for (int k = 0; k < n; k++) out[static_cast<size_t>(f0 + k)] = static_cast<float>(buf[k]);
  }
  std::fwrite(out.data(), sizeof(float), out.size(), stdout);
  return 0;
}
