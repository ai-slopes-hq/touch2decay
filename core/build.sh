#!/usr/bin/env bash
# Сборка ядра: render-cli и sdk-test (нативно, для сверки) и goetia.wasm, pulsar.wasm и ocean.wasm (в корень, рядом с worklet). Запуск из любой папки: core/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p core/build
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/render-cli core/render-cli/main.cpp core/worlds/goetia/goetia.cpp core/worlds/firmamentum/pulsar.cpp core/worlds/oceanus/ocean.cpp
echo "core/build/render-cli"
clang++ -std=c++17 -O2 -ffp-contract=off -Wall -Wextra -o core/build/sdk-test core/tests/sdk_test.cpp
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
