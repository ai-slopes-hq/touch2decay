#!/usr/bin/env bash
# Сборка ядра: render-cli и sdk-test (нативно, для сверки) и goetia.wasm, pulsar.wasm, ocean.wasm и t2d.wasm (в корень, рядом с worklet). Запуск из любой папки: core/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p core/build
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/render-cli core/render-cli/main.cpp core/worlds/goetia/goetia.cpp core/worlds/firmamentum/pulsar.cpp core/worlds/oceanus/ocean.cpp
echo "core/build/render-cli"
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/sdk-test core/tests/sdk_test.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp
echo "core/build/sdk-test"
emcc -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS=_gt_init,_gt_prog_buf,_gt_prog,_gt_voice,_gt_fx,_gt_process,_gt_t0,_gt_gv,_gt_set_t \
  -sFILESYSTEM=0 -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
  -o goetia.wasm core/worlds/goetia/wasm.cpp core/worlds/goetia/goetia.cpp
echo "goetia.wasm ($(wc -c < goetia.wasm | tr -d ' ') bytes)"
emcc -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS=_pl_init,_pl_voice,_pl_fx,_pl_process,_pl_count,_pl_gain,_pl_ck,_pl_ck_buf,_pl_fl,_pl_fl_buf \
  -sFILESYSTEM=0 -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
  -o pulsar.wasm core/worlds/firmamentum/wasm.cpp core/worlds/firmamentum/pulsar.cpp
echo "pulsar.wasm ($(wc -c < pulsar.wasm | tr -d ' ') bytes)"
emcc -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS=_oc_init,_oc_params,_oc_push,_oc_release,_oc_splash,_oc_voice,_oc_process,_oc_shape,_oc_moon,_oc_gain \
  -sFILESYSTEM=0 -sINITIAL_MEMORY=1MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
  -o ocean.wasm core/worlds/oceanus/wasm.cpp core/worlds/oceanus/ocean.cpp
echo "ocean.wasm ($(wc -c < ocean.wasm | tr -d ' ') bytes)"
# t2d.wasm — хост SDK и все миры SDK одним модулем (core/bridge/wasm.cpp); хост ~1.2 МБ статики — память 4 МБ; em++ — нужен libc++ (std::string снимка)
em++ -O3 -std=c++17 -ffp-contract=off -fno-exceptions -Wall -sSTANDALONE_WASM --no-entry \
  -sEXPORTED_FUNCTIONS=_t2d_init,_t2d_args,_t2d_action,_t2d_process,_t2d_dry,_t2d_ret,_t2d_ext,_t2d_mbuf,_t2d_mirror,_t2d_heard,_t2d_str_buf,_t2d_str_cap,_t2d_snapshot,_t2d_restore,_t2d_fader,_t2d_scale \
  -sFILESYSTEM=0 -sINITIAL_MEMORY=4MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
  -o t2d.wasm core/bridge/wasm.cpp core/sdk/reverb.cpp core/host/host.cpp core/host/scale.cpp \
  core/worlds/firmamentum/model.cpp core/worlds/firmamentum/world.cpp
echo "t2d.wasm ($(wc -c < t2d.wasm | tr -d ' ') bytes)"
