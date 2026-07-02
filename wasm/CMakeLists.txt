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
