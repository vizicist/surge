# Surge XT WebAssembly module.
#
# Enabled with -DSURGE_BUILD_WASM=TRUE when configuring through emcmake. Builds
# the headless engine (surge::surge-common) plus a small embind binding into a
# loadable WASM module (surge.js + surge.wasm).

project(surge-wasm)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "SURGE_BUILD_WASM requires configuring with emcmake (Emscripten).")
endif()

add_executable(surgewasm binding.cpp)

target_link_libraries(surgewasm PRIVATE surge::surge-common)

# C++ exceptions are used throughout the engine (storage/patch loading).
target_compile_options(surgewasm PRIVATE -fexceptions)

set_target_properties(surgewasm PROPERTIES
  OUTPUT_NAME "surge"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/web"
)

target_link_options(surgewasm PRIVATE
  "-fexceptions"
  "--bind"
  "-O3"
  "-sMODULARIZE=1"
  "-sEXPORT_NAME=createSurgeModule"
  "-sENVIRONMENT=web"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=67108864"
  "-sSTACK_SIZE=1048576"
  "-sASSERTIONS=1"
)

# ---------------------------------------------------------------------------
# WAM (Web Audio Module) DSP flavor.
#
# Same SurgeBridge binding, but linked so the module can be instantiated INSIDE
# an AudioWorkletGlobalScope (the WAM runs Surge's DSP in the audio thread, not
# on the main thread like the demo above). Differences from surgewasm:
#   ENVIRONMENT=web,worker : the glue must run in the worklet, not just a page.
#   EXPORT_ES6=0 (default) : classic script, loadable via audioWorklet.addModule.
#   ALLOW_MEMORY_GROWTH=0  : growth is unavailable on the audio thread's fixed
#                            heap; reserve a generous INITIAL_MEMORY instead.
#   ASSERTIONS=0           : keep the audio-thread module lean.
# Emitted as surge-wam-dsp.js (+ .wasm) next to the WAM's JS under wasm/wam/.
add_executable(surgewam binding.cpp)

target_link_libraries(surgewam PRIVATE surge::surge-common)

target_compile_options(surgewam PRIVATE -fexceptions)

set_target_properties(surgewam PROPERTIES
  OUTPUT_NAME "surge-wam-dsp"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wam"
)

target_link_options(surgewam PRIVATE
  "-fexceptions"
  "--bind"
  "-O3"
  "-sMODULARIZE=1"
  "-sEXPORT_NAME=createSurgeModule"
  "-sENVIRONMENT=web,worker"
  "-sALLOW_MEMORY_GROWTH=0"
  "-sINITIAL_MEMORY=134217728"
  "-sSTACK_SIZE=1048576"
  "-sASSERTIONS=0"
)
