// C-API слоя приложения (iOS): render для аудиопотока, действия UI, зеркало и heard по слотам, статистика. Реализация — engine.cpp.
// Сверху ядра SDK (core/bridge/t2d.h). Один экземпляр на процесс.
#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  double load_avg, load_max;  // доля длительности буфера, за окно
  double lat_avg, lat_max;    // сек, блок − касание, без outputLatency, за окно
  int lat_n;                  // применённых действий с меткой за окно
  int frames;                 // последний размер буфера устройства
  unsigned dropped;           // действий не влезло в кольцо, всего
  unsigned heard_lost;        // записей heard не влезло, всего
} t2d_app_stats_t;

// init не потокобезопасен относительно render (переписывает поля и чистит кольца): перед повторным вызовом остановить аудиодвижок.
void t2d_app_init(double sr, unsigned seed, double ticks_per_sec, unsigned watch); // watch — маска слотов
void t2d_app_render(float* L, float* R, int n, uint64_t host_time);
int  t2d_app_action(int slot, int kind, int i, const double* a, int n, uint64_t touch_time); // 0 — отброшено; touch_time 0 — без замера
int  t2d_app_mirror(int slot, double* buf, int cap);  // последний снимок, длина
int  t2d_app_heard(int slot, double* buf, int cap);   // забрать накопленные записи подряд, длина
void t2d_app_stats(t2d_app_stats_t* out);             // снять окно (avg/max обнуляются)

#ifdef __cplusplus
}
#endif
