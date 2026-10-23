// Линейная панорама как в worklet-ах: pan = p·spread, gl = (1 − pan)/2, gr = (1 + pan)/2 (p = 0 — по 0.5).
#pragma once

namespace sdk {

inline void panLin(double p, double spread, double& gl, double& gr) {
  double pan = p * spread;
  gl = (1 - pan) * 0.5;
  gr = (1 + pan) * 0.5;
}

}  // namespace sdk
