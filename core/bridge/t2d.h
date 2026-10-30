// C-ABI ядра SDK: хост и миры по слотам, один экземпляр. Реализация — api.cpp (общая для wasm и iOS), экспорт wasm — build.sh.
#pragma once
#ifdef __cplusplus
extern "C" {
#endif

void t2d_init(double sr, unsigned seed);
double* t2d_args();
void t2d_action(int slot, int kind, int i, const double* a, int n);
void t2d_process(int n);
const float* t2d_dry(int slot, int ch);
const float* t2d_ret(int ch);
float* t2d_ext(int rev, int ch);
double* t2d_mbuf();
int t2d_mirror(int slot);
int t2d_heard(int slot);
char* t2d_str_buf();
int t2d_str_cap();
int t2d_snapshot(int slot);
void t2d_restore(int slot, int len);
void t2d_fader(int slot, double g);
void t2d_scale(int on, int idx, int root);
void t2d_vol(double g);
void t2d_time(double t);
void t2d_midi_byte(int src, int status, double at);
void t2d_midi_msg(int kind, double n, double bpm, double at);
int t2d_hmirror();
int t2d_hevents();
const float* t2d_arc_land(int which);
void t2d_master_lpf(double hz);
void t2d_master_comp(double thr, double ratio);
void t2d_master_ceil(double db);
void t2d_sum(float* L, float* R, int n);          // Σ dry·фейдер·trim + ret, n ≤ 128
void t2d_master_run(float* L, float* R, int n);   // мастер по цепочке веба, на месте
void t2d_mix(float* L, float* R, int n);          // sum + master_run
double t2d_master_makeup(void);                   // авто-подъём компрессора (для тестов)
int t2d_lfo_add(int slot, int obj, int key, double base, int shape);
void t2d_lfo_spec(int idx, double morph, double rate, double depth);
void t2d_lfo_off(int idx);
int t2d_lfo_state(int idx, double* out);                 // 10 чисел: slot, obj, key, base, morph, rate, depth, u, shape, seed; 0 — нет
unsigned t2d_lfo_lost(void);
void t2d_model_tick(double dt);

#ifdef __cplusplus
}
#endif
