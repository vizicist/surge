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

        // The bare headless init patch defaults filter 1 to fut_none (bypass), so
        // the exposed cutoff/resonance/EG-depth parameters would be inaudible.
        // Start with an active 24 dB lowpass - a sensible, musical default.
        synth->storage.getPatch().scene[0].filterunit[0].type.val.i =
            sst::filters::fut_lp24;
        synth->storage.getPatch().update_controls(false);
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

    // --- Curated automatable parameters ------------------------------------
    // A small, musically important subset of scene-A parameters exposed to WAM
    // automation, addressed by index. Keep this in sync with PARAM_INFO in the
    // WAM processor (surge-wam-processor.js). Values are normalized 0..1 so the
    // WAM parameter range maps straight through with no unit conversion.
    Parameter *curatedParam(int which)
    {
        auto &sc = synth->storage.getPatch().scene[0];
        switch (which)
        {
        case 0:  return &sc.filterunit[0].cutoff;
        case 1:  return &sc.filterunit[0].resonance;
        case 2:  return &sc.filterunit[0].envmod;
        case 3:  return &sc.adsr[0].a; // amp EG
        case 4:  return &sc.adsr[0].d;
        case 5:  return &sc.adsr[0].s;
        case 6:  return &sc.adsr[0].r;
        case 7:  return &sc.adsr[1].a; // filter EG
        case 8:  return &sc.adsr[1].d;
        case 9:  return &sc.adsr[1].s;
        case 10: return &sc.adsr[1].r;
        case 11: return &sc.lfo[0].rate;
        default: return nullptr;
        }
    }

    // Set a curated parameter from a normalized 0..1 value.
    void setParamNorm(int which, float v01)
    {
        if (auto *p = curatedParam(which))
            p->set_value_f01(v01);
    }

    // Read a curated parameter's current normalized 0..1 value (reflects the
    // loaded patch, so hosts can re-sync after loadPatchBytes()).
    float getParamNorm(int which)
    {
        auto *p = curatedParam(which);
        return p ? p->get_value_f01() : 0.f;
    }

    // --- Filter 1 type (a discrete choice, exposed separately) --------------
    int numFilterTypes() const { return (int)sst::filters::num_filter_types; }

    std::string filterTypeName(int i) const
    {
        if (i < 0 || i >= (int)sst::filters::num_filter_types)
            return "";
        return sst::filters::filter_type_names[i];
    }

    void setFilterType(int type)
    {
        const int n = (int)sst::filters::num_filter_types;
        type = type < 0 ? 0 : (type >= n ? n - 1 : type);
        auto &fu = synth->storage.getPatch().scene[0].filterunit[0];
        fu.type.val.i = type;
        fu.subtype.val.i = 0;
        synth->storage.getPatch().update_controls(false);
    }

    int getFilterType() const
    {
        return synth->storage.getPatch().scene[0].filterunit[0].type.val.i;
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
        .function("setParamNorm", &SurgeBridge::setParamNorm)
        .function("getParamNorm", &SurgeBridge::getParamNorm)
        .function("numFilterTypes", &SurgeBridge::numFilterTypes)
        .function("filterTypeName", &SurgeBridge::filterTypeName)
        .function("setFilterType", &SurgeBridge::setFilterType)
        .function("getFilterType", &SurgeBridge::getFilterType)
        .function("loadPatchBytes", &SurgeBridge::loadPatchBytes)
        .function("patchName", &SurgeBridge::patchName)
        .function("patchAuthor", &SurgeBridge::patchAuthor)
        .function("patchCategory", &SurgeBridge::patchCategory)
        .function("render", &SurgeBridge::render);
}
