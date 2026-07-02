/*
 * Emscripten shim for <execinfo.h>.
 *
 * Emscripten's sysroot has no glibc backtrace support. sst-plugininfra's Linux
 * platform file (selected because Emscripten looks like Linux) pulls in
 * <execinfo.h> only to print stack traces. These no-op stubs let it compile;
 * stack traces are simply empty in the browser. Only on the include path for
 * the WASM build (SURGE_BUILD_WASM).
 */
#ifndef SURGE_WASM_EXECINFO_SHIM_H
#define SURGE_WASM_EXECINFO_SHIM_H

#include <cstddef>

static inline int backtrace(void **, int) { return 0; }
static inline char **backtrace_symbols(void *const *, int) { return nullptr; }
static inline void backtrace_symbols_fd(void *const *, int, int) {}

#endif // SURGE_WASM_EXECINFO_SHIM_H
