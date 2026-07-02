/*
 * Surge XT WebAssembly binding.
 *
 * Wraps the headless SurgeSynthesizer engine (no JUCE, no GUI) behind a tiny
 * embind API so it can be driven from JavaScript / Web Audio. Built only when
 * targeting Emscripten via the SURGE_BUILD_WASM CMake option.
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <memory>
#include <vector>
#include <string>
#include <fstream>

#include "SurgeSynthesizer.h"
#include "SurgeStorage.h"

using namespace emscripten;

// Minimal PluginLayer: the engine calls back into its host for parameter/macro
// change notifications. A headless host just ignores them.
class WasmPluginLayer : public SurgeSynthesizer::PluginLayer
{
  public:
    void surgeParameterUpdated(const SurgeSynthesizer::ID &, float) override {}
    void surgeMacroUpdated(long, float) override {}
};

class SurgeBridge
{
  public:
    explicit SurgeBridge(float sampleRate)
    {
        layer = std::make_unique<WasmPluginLayer>();
        // skipPatchLoadDataPathSentinel => do not scan disk for factory patches;
        // the engine boots on its default init patch using embedded resources.
        synth = std::make_unique<SurgeSynthesizer>(
            layer.get(), SurgeStorage::skipPatchLoadDataPathSentinel);
        synth->setSamplerate(sampleRate);
        synth->time_data.tempo = 120;
        synth->time_data.ppqPos = 0;
        interleaved.reserve(2 * 2048);
    }

    int blockSize() const { return synth->getBlockSize(); }

    void noteOn(int channel, int key, int velocity)
    {
        synth->playNote((char)channel, (char)key, (char)velocity, 0);
    }

    void noteOff(int channel, int key, int velocity)
    {
        synth->releaseNote((char)channel, (char)key, (char)velocity);
    }

    void pitchBend(int channel, int value) { synth->pitchBend((char)channel, value); }

    void controller(int channel, int cc, int value)
    {
        synth->channelController((char)channel, cc, value);
    }

    void allNotesOff() { synth->allNotesOff(); }

    // Select oscillator type for scene A, all 3 oscillators (0..N_osc_types-1).
    void setOscType(int type)
    {
        auto &patch = synth->storage.getPatch();
        for (int o = 0; o < n_oscs; ++o)
        {
            patch.scene[0].osc[o].type.val.i = type;
        }
        synth->storage.getPatch().update_controls(false);
    }

    // Load a factory .fxp patch supplied as raw bytes (a JS Uint8Array). The
    // bytes are written to a MEMFS temp file and handed to the engine's normal
    // loader, which parses the VST2 fxp wrapper and applies the patch. Returns
    // false if the data is not a valid Surge patch.
    bool loadPatchBytes(std::string name, emscripten::val jsBytes)
    {
        std::vector<uint8_t> bytes = emscripten::convertJSArrayToNumberVector<uint8_t>(jsBytes);
        if (bytes.empty())
            return false;
        const char *path = "/tmp/_audition.fxp";
        {
            std::ofstream o(path, std::ios::binary | std::ios::trunc);
            if (!o.good())
                return false;
            o.write(reinterpret_cast<const char *>(bytes.data()), (std::streamsize)bytes.size());
        }
        return synth->loadPatchByPath(path, -1, name.c_str());
    }

    std::string patchName() const { return synth->storage.getPatch().name; }
    std::string patchAuthor() const { return synth->storage.getPatch().author; }
    std::string patchCategory() const { return synth->storage.getPatch().category; }

    // Render `frames` frames (rounded up to a whole number of engine blocks) of
    // stereo audio and return a typed-memory view over the interleaved buffer.
    // The view is valid until the next render() call.
    val render(int frames)
    {
        const int bs = synth->getBlockSize();
        int blocks = (frames + bs - 1) / bs;
        int total = blocks * bs;
        interleaved.assign((size_t)total * 2, 0.f);

        for (int b = 0; b < blocks; ++b)
        {
            synth->process();
            float *L = synth->output[0];
            float *R = synth->output[1];
            for (int i = 0; i < bs; ++i)
            {
                interleaved[((size_t)(b * bs + i)) * 2 + 0] = L[i];
                interleaved[((size_t)(b * bs + i)) * 2 + 1] = R[i];
            }
        }
        return val(typed_memory_view(interleaved.size(), interleaved.data()));
    }

  private:
    std::unique_ptr<WasmPluginLayer> layer;
    std::unique_ptr<SurgeSynthesizer> synth;
    std::vector<float> interleaved;
};

EMSCRIPTEN_BINDINGS(surge)
{
    class_<SurgeBridge>("SurgeBridge")
        .constructor<float>()
        .function("blockSize", &SurgeBridge::blockSize)
        .function("noteOn", &SurgeBridge::noteOn)
        .function("noteOff", &SurgeBridge::noteOff)
        .function("pitchBend", &SurgeBridge::pitchBend)
        .function("controller", &SurgeBridge::controller)
        .function("allNotesOff", &SurgeBridge::allNotesOff)
        .function("setOscType", &SurgeBridge::setOscType)
        .function("loadPatchBytes", &SurgeBridge::loadPatchBytes)
        .function("patchName", &SurgeBridge::patchName)
        .function("patchAuthor", &SurgeBridge::patchAuthor)
        .function("patchCategory", &SurgeBridge::patchCategory)
        .function("render", &SurgeBridge::render);
}
