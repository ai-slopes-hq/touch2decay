// Engine — движок приложения iOS поверх ядра (core/bridge/t2d.h). В t2d.wasm не идёт: веб делает то же сам, на Web Audio.
// Наружу — C API core/app/t2d_app.h (один статический экземпляр в t2d_app.cpp).
//
//   поток UI                                    аудиопоток (render)
//   action / restore ──→ actions_ (Spsc) ──────→ block(): действия → сглаживание → t2d_lfo_tick → t2d_process → t2d_mix
//   restore: строка ──→ restoreText_ (Spsc) ────↗          │
//   mirror()  ←── mirrors_[слот] (Triple)  ←────── publishSnapshots(): зеркала, таблица LFO, уровни — раз за render
//   lfo()     ←── lfoSnap_ (Triple)        ←──────┘
//   levels()  ←── levelSnap_ (Triple)      ←──────┘
//   heard()   ←── heard_[слот] (Spsc)      ←────── block(): записи «услышано» каждого блока
//   snapTake()←── snapText_ (Spsc)         ←────── действие SNAP слота хоста
//   midi()    ──→ midi_ (Spsc, поток CoreMIDI) ──→ renderBlock(): t2d_midi_byte до t2d_time; после process: t2d_hevents → hev_
//   hevents() ←── hev_ (Spsc)              ←──────┘      grid() ←── gridSnap_ (Triple) ←── publishSnapshots(): t2d_hmirror
//   stats()   ←── атомарные счётчики       ←────── render (нагрузка), block (задержка касание → блок), SNAP (время снимка)
//
// render(n): ядро считает только по 128 сэмплов, буфер устройства — любой (iPhone: 256, 512, 441 …). Сначала отдаётся остаток
// прошлого блока, потом целые блоки; хвост последнего блока остаётся до следующего render. Действия, пришедшие за это время,
// применяются в начале каждого блока — точность касания ±128 сэмплов, не размер буфера.
//
// ЛОВУШКИ:
//   - Ядро (t2d_*, mbuf, str_buf) трогает только аудиопоток. Из UI — только через кольца и снимки ниже.
//   - init не потокобезопасен: переписывает поля и чистит кольца. Звать, пока аудио стоит (до старта AVAudioEngine и после стопа).
//   - Каждое кольцо — один писатель и один читатель. Два потока UI, зовущие action, сломают кольцо.
//   - Кольцо полно — действие отброшено (false, счётчик dropped), а не ждёт. UI должен уметь пережить потерю.
//   - Зеркала и heard пишутся только для слотов из маски watch (init). Уровни (levels) — для всех слотов.
//   - Строки (restore, снимки) лежат в кольцах ёмкостью 2: третий снимок, пока UI не забрал два, теряется (snap_lost).
//   - Действие RESTORE без парной строки (через публичный t2d_app_action) ничего не делает, если строки нет; если есть —
//     заберёт чужую раньше времени. Слать restore только через restore().
// Цена: ~3 МБ памяти (кольца и снимки), поэтому экземпляр статический. В render — без аллокаций, блокировок и printf;
// сверх ядра — копии зеркал раз за render и сумма квадратов сухого выхода 16 слотов за блок.
#pragma once
#include <atomic>
#include <cstdint>
#include "spsc.hpp"
#include "triple.hpp"
#include "t2d_app.h"

class Engine {
 public:
  static constexpr int BLOCK = 128, SLOTS = 16;
  static constexpr int ACT_CAP = 256, ACT_ARGS = 128;       // кольцо действий; чисел в действии (узор Cymatica — 117)
  static constexpr int HEARD_RECS = 64, HEARD_REC = 256;    // записей heard на слот; чисел в записи (Cymatica ≤ 200)
  static constexpr int MIRROR_CAP = 2048;                   // = MBUF ядра
  static constexpr int LFO_N = T2D_APP_LFO_MAX * T2D_APP_LFO_REC;   // снимок LFO: LFO_MAX · 10 чисел
  static constexpr int STR = 1 << 16;                       // строка снимка, = t2d_str_cap()
  enum { RESTORE = 15 };                                    // внутренний kind слота хоста (после T2D_H_*, не пересекается с ними): строка из кольца UI → аудио

  // Полный сброс (кольца, остаток блока, статистика, сглаживание) + t2d_init. Только пока аудио стоит.
  // ticksPerSec — единица меток touch / host (такты mach, Clock.ticksPerSec в ios/app: ~2.4e7 на iPhone; в тестах 1e9);
  // touch и host обязаны быть в одних тактах, иначе задержка считается мимо. watch — маска слотов.
  void init(double sr, unsigned seed, double ticksPerSec, unsigned watch);
  // Аудиопоток: n сэмплов в L и R (любое n > 0). host — время начала буфера в тиках (для задержки касание → блок; 0 — без замера).
  void render(float* L, float* R, int n, uint64_t host);
  // UI: действие в кольцо (slot = T2D_HOST — действие хоста, коды T2D_H_*). touch — метка касания в тиках, 0 — без замера.
  // false — отброшено: кольцо полно, n вне 0…ACT_ARGS или a = nullptr при n > 0.
  bool action(int slot, int kind, int i, const double* a, int n, uint64_t touch);
  // UI: последнее зеркало слота (копия, пока аудио не опубликует новее); длина, 0 — слот не в watch, зеркала нет или cap мал.
  int mirror(int slot, double* buf, int cap);
  // UI: строка снимка в кольцо + действие RESTORE в кольцо действий — восстановится в порядке с касаниями. false — отброшено.
  bool restore(int slot, const char* s, int len, uint64_t touch);
  int snapTake(int* id, int* slot, char* buf, int cap);     // UI: готовый снимок; длина, 0 — нет (не влез в cap — потерян)
  int levels(float* out, int n);                            // UI: RMS слотов до фейдера (индекс = слот); 1 — снимок новее прошлого чтения
  int lfo(double* buf, int cap);                            // UI: снимок LFO (по 10 чисел), длина
  int heard(int slot, double* buf, int cap);                // UI: забрать записи подряд, пока влезают; длина
  bool midi(int src, int status, uint64_t mach);            // поток CoreMIDI (один!): байт реального времени в кольцо; false — полно (midi_lost)
  int hevents(double* buf, int cap);                        // UI: события часов подряд — пары (код, bpm), пока влезают; число double
  int grid(double* out4);                                   // UI: последний снимок t2d_hmirror (on, t0, p, время блока); 4
  void stats(t2d_app_stats_t* out);                         // UI: снимает окно (суммы и максимумы обнуляются)

 private:
  struct Action { int slot, kind, i, n; uint64_t touch; double a[ACT_ARGS]; };
  struct Text { int slot, id, len; char d[STR]; };          // строка снимка: restore (UI → аудио) и SNAP (аудио → UI); id — от запроса SNAP
  struct Mirror { int len; double d[MIRROR_CAP]; };
  struct LfoTable { int len; double d[LFO_N]; };
  struct Levels { float rms[SLOTS]; };
  struct HeardRec { int len; double d[HEARD_REC]; };
  struct Midi { int src, status; uint64_t mach; };          // байт MIDI реального времени с меткой прихода (такты mach)
  struct HEv { double code, bpm; };                         // событие часов хоста (sdk::Follower::Ev)
  struct Grid { double d[4]; };                             // t2d_hmirror: on, t0, p, время блока
  // мастер, который сглаживаем: частота LPF — в логарифме (ровный ход по слуху), порог компрессора в дБ, ratio, потолок в дБ
  enum { LPF_LOG, THRESHOLD_DB, RATIO, CEIL_DB, MASTER_N };

  void hostAction(const Action& act);                       // действие слота хоста (T2D_H_*, RESTORE)
  void stepSmooth();                                        // шаг сглаживания фейдеров и мастера (раз в блок)
  void renderBlock(uint64_t host, int offset);              // один 128-блок в blockL_ / blockR_
  void publishSnapshots();                                  // зеркала, таблица LFO, уровни — UI
  static void addMax(std::atomic<uint64_t>& m, uint64_t v);   // m = max(m, v) без блокировок

  double sr_ = 48000, ticksPerSec_ = 1e9;
  unsigned watch_ = 0;                                      // маска слотов: бит s — писать зеркало и heard слота s
  // Цели (от UI) и текущие значения (шаг раз в блок): фейдер слота — линейное усиление; мастер — по индексам LPF_LOG … CEIL_DB.
  // Начальные значения — как у Host::prepare (фейдер 1, LPF 22 кГц, −10 дБ, 2.5, 0 дБ).
  double faderTarget_[SLOTS], faderNow_[SLOTS], masterTarget_[MASTER_N], masterNow_[MASTER_N];
  double samplesDone_ = 0;                                  // обработано сэмплов с init — время ядра (t2d_time)
  float blockL_[BLOCK], blockR_[BLOCK];                     // последний посчитанный блок
  int restOff_ = 0, restN_ = 0;                             // его неотданный хвост: blockL_[restOff_ .. restOff_ + restN_)

  Spsc<Action, ACT_CAP> actions_;
  Triple<Mirror> mirrors_[SLOTS];
  Mirror mirrorRead_[SLOTS];                                // последнее прочитанное UI (UI отдаёт его, пока нет новее)
  Triple<LfoTable> lfoSnap_;                                // снимок таблицы LFO, как зеркало
  LfoTable lfoRead_;
  Triple<Levels> levelSnap_;                                // уровни слотов для карты
  Levels levelRead_{};
  // Σ моно² сухого выхода слота за последний и предыдущий блок: RMS по 256 сэмплам, как fftSize анализатора веба
  float energyNow_[SLOTS] = {}, energyPrev_[SLOTS] = {};
  Spsc<HeardRec, HEARD_RECS> heard_[SLOTS];
  Spsc<Midi, 512> midi_;                                    // CoreMIDI → аудио; свой писатель — поток CoreMIDI, не UI
  Spsc<HEv, 128> hev_;                                      // аудио → UI: события часов (= 256 чисел); полно — теряются (hevLost_)
  Triple<Grid> gridSnap_;                                   // сетка хоста для UI
  Grid gridRead_{};
  Spsc<Text, 2> restoreText_, snapText_;                    // строки UI → аудио (restore) и аудио → UI (снимки)

  // Статистика окна (между вызовами stats): суммы в целых — нс и доли ×1e9, чтобы снимать атомарным exchange.
  std::atomic<uint64_t> loadSum_{0}, loadMax_{0}, loadN_{0}, latSum_{0}, latMax_{0}, latN_{0}, snapSum_{0}, snapMax_{0}, snapN_{0};
  std::atomic<int> frames_{0};                              // размер последнего буфера устройства
  // счётчики за всё время с init; lfoLost_ — копия счётчика хоста, чтобы UI не трогал ядро
  std::atomic<unsigned> dropped_{0}, heardLost_{0}, snapLost_{0}, lfoLost_{0}, midiLost_{0}, hevLost_{0};
};
