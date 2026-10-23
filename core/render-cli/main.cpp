// render-cli — офлайн-рендер ядра для сверки с вебом (tools/test-goetia-core.mjs, tools/test-firm-core.mjs).
// world <goetia|firmamentum> — первой строкой (по умолчанию goetia), дальше команды мира.
// stdin, по команде в строке: init <sr> · prog <i> <код> <сдвиг> … · voice <i> <on> <rate> <lp> <lvl> <legio> <pan> <rel> <trig>
// · fx <spread> <wide> · sett <i> <t> · run <блоков>.
// Firmamentum: init <sr> <зерно> · voice <i> <on 1|0|-1> <fp> <ff> <cyc> <win> <mask> <lvl> <pan> · fx <jit> <spread> <crep> <fulg> · run <блоков>.
// stdout: на каждый блок 128 float32 L, затем 128 float32 R.
#include <cstdio>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "../worlds/firmamentum/pulsar.hpp"
#include "../worlds/goetia/goetia.hpp"

int main() {
  constexpr int BLOCK = 128;
  std::unique_ptr<goetia::Goetia> core;
  std::unique_ptr<firmamentum::Pulsar> firm;
  bool isFirm = false;
  float L[BLOCK], R[BLOCK];
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd;
    if (!(in >> cmd)) continue;
    if (cmd == "world") { std::string w; in >> w; isFirm = w == "firmamentum"; if (!isFirm && w != "goetia") { std::fprintf(stderr, "unknown world: %s\n", w.c_str()); return 1; } continue; }
    if (isFirm) {
      if (cmd == "init") { double sr; uint32_t seed; in >> sr >> seed; firm = std::make_unique<firmamentum::Pulsar>(sr, seed); continue; }
      if (!firm) { std::fprintf(stderr, "init first\n"); return 1; }
      if (cmd == "voice") {
        int i, on; double fp, ff, cyc, win, mask, lvl, pan;
        in >> i >> on >> fp >> ff >> cyc >> win >> mask >> lvl >> pan;
        firm->voice(i, on, fp, ff, cyc, win, mask, lvl, pan);
      } else if (cmd == "fx") {
        double jit, spread, crep, fulg; in >> jit >> spread >> crep >> fulg; firm->fx(jit, spread, crep, fulg);
      } else if (cmd == "run") {
        int blocks; in >> blocks;
        for (int b = 0; b < blocks; b++) {
          firm->process(L, R, BLOCK);
          std::fwrite(L, sizeof(float), BLOCK, stdout);
          std::fwrite(R, sizeof(float), BLOCK, stdout);
        }
      } else { std::fprintf(stderr, "unknown command: %s\n", cmd.c_str()); return 1; }
      continue;
    }
    if (cmd == "init") { double sr; in >> sr; core = std::make_unique<goetia::Goetia>(sr); continue; }
    if (!core) { std::fprintf(stderr, "init first\n"); return 1; }
    if (cmd == "prog") {
      int i; in >> i;
      std::vector<int> pairs; int x;
      while (in >> x) pairs.push_back(x);
      core->prog(i, static_cast<int>(pairs.size() / 2), pairs.data());
    } else if (cmd == "voice") {
      int i, on, legio, trig; double rate, lp, lvl, pan, rel;
      in >> i >> on >> rate >> lp >> lvl >> legio >> pan >> rel >> trig;
      core->voice(i, on != 0, rate, lp, lvl, legio, pan, rel, trig);
    } else if (cmd == "fx") {
      double spread, wide; in >> spread >> wide; core->fx(spread, wide);
    } else if (cmd == "sett") {
      int i; double t; in >> i >> t; core->setT(i, t);
    } else if (cmd == "run") {
      int blocks; in >> blocks;
      for (int b = 0; b < blocks; b++) {
        core->process(L, R, BLOCK);
        std::fwrite(L, sizeof(float), BLOCK, stdout);
        std::fwrite(R, sizeof(float), BLOCK, stdout);
      }
    } else { std::fprintf(stderr, "unknown command: %s\n", cmd.c_str()); return 1; }
  }
  return 0;
}
