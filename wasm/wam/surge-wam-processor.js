/*
 * Surge XT WAM - AudioWorkletProcessor (the audio thread).
 *
 * This runs inside the AudioWorkletGlobalScope. The Surge Emscripten module
 * (surge-wam-dsp.js, added to the same worklet scope before this file) defines
 * the global `createSurgeModule` factory; we instantiate it here with the wasm
 * bytes handed over from the main thread, then drive SurgeBridge::render() once
 * per audio quantum. WAM MIDI + parameter events arrive over the MessagePort.
 *
 * The module init is async but the processor constructor is not, so process()
 * emits silence until `this.ready` flips true.
 */

// AudioWorkletGlobalScope omits a few Web APIs that the Emscripten runtime and
// Surge's engine expect. Install minimal shims. These are getter-only global
// accessors here, so a plain assignment is silently dropped in (non-strict)
// worklet code - define the property instead.
function installGlobal(name, value) {
    if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return;
    try {
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch (_e) {
        try { globalThis[name] = value; } catch (_e2) { /* last resort: nothing */ }
    }
}

// crypto.getRandomValues - Emscripten's WASI random_get (Surge RNG seeding).
// Non-cryptographic entropy is fine here.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
    installGlobal('crypto', {
        getRandomValues(arr) {
            for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
            return arr;
        },
    });
}

// performance.now() - Emscripten's emscripten_get_now / Surge timing. The
// worklet's `currentTime` (seconds) gives a monotonic clock.
if (typeof globalThis.performance === 'undefined' || !globalThis.performance.now) {
    installGlobal('performance', {
        now() { return (typeof currentTime === 'number' ? currentTime : 0) * 1000; },
        timeOrigin: 0,
    });
}

// Curated WAM parameters. Surge has hundreds of engine parameters; the WAM
// exposes a small automatable set and lets MIDI drive the rest.
//
// Two are handled specially: `osc_type` (a choice, via SurgeBridge::setOscType)
// and `volume` (a host-side output gain). The rest are engine parameters,
// addressed by `engineIndex` and set/read normalized 0..1 through
// SurgeBridge::setParamNorm / getParamNorm. Those indices MUST match the
// curatedParam() switch in wasm/binding.cpp.
const OSC_NAMES = ['Classic', 'Sine', 'Wavetable', 'Window', 'FM2', 'FM3',
                   'S&H Noise', 'Alias', 'String', 'Twist', 'Modern'];

function floatParam(id, label, engineIndex, defaultValue) {
    return { id, label, type: 'float', defaultValue, minValue: 0, maxValue: 1,
             discreteStep: 0, exponent: 1, choices: [], units: '', engineIndex };
}

const PARAM_INFO = {
    osc_type: {
        id: 'osc_type', label: 'Oscillator', type: 'choice',
        defaultValue: 0, minValue: 0, maxValue: OSC_NAMES.length - 1,
        discreteStep: 1, exponent: 1, choices: OSC_NAMES, units: '',
    },
    // Filter 1 type - a choice; its `choices` list is filled from the engine on
    // boot (the WAM defaults to an active 24 dB lowpass so the filter is audible).
    filter_type: {
        id: 'filter_type', label: 'Filter Type', type: 'choice',
        defaultValue: 0, minValue: 0, maxValue: 0,
        discreteStep: 1, exponent: 1, choices: [], units: '',
    },
    // Filter 1 (normalized). Defaults are refreshed from the engine on boot.
    filter_cutoff:    floatParam('filter_cutoff',    'Filter Cutoff',      0, 0.5),
    filter_resonance: floatParam('filter_resonance', 'Filter Resonance',   1, 0.0),
    filter_envmod:    floatParam('filter_envmod',    'Filter EG Depth',    2, 0.5),
    // Amp envelope (engine adsr[0]).
    amp_attack:       floatParam('amp_attack',       'Amp Attack',         3, 0.0),
    amp_decay:        floatParam('amp_decay',        'Amp Decay',          4, 0.5),
    amp_sustain:      floatParam('amp_sustain',      'Amp Sustain',        5, 1.0),
    amp_release:      floatParam('amp_release',      'Amp Release',        6, 0.2),
    // Filter envelope (engine adsr[1]).
    feg_attack:       floatParam('feg_attack',       'Filter EG Attack',   7, 0.0),
    feg_decay:        floatParam('feg_decay',        'Filter EG Decay',    8, 0.5),
    feg_sustain:      floatParam('feg_sustain',      'Filter EG Sustain',  9, 1.0),
    feg_release:      floatParam('feg_release',      'Filter EG Release', 10, 0.2),
    // LFO 1 rate.
    lfo1_rate:        floatParam('lfo1_rate',        'LFO 1 Rate',        11, 0.5),
    // Host-side output gain (not an engine parameter).
    volume: {
        id: 'volume', label: 'Volume', type: 'float',
        defaultValue: 0.8, minValue: 0, maxValue: 1,
        discreteStep: 0, exponent: 1, choices: [], units: '',
    },
};

class SurgeWamProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.ready = false;
        this.bridge = null;
        this.gain = PARAM_INFO.volume.defaultValue;
        this.params = {};
        for (const pid in PARAM_INFO) this.params[pid] = PARAM_INFO[pid].defaultValue;
        this.pending = []; // queued { time, bytes } MIDI events
        this._reportedError = false;

        this.port.onmessage = (e) => this._onMessage(e);

        const wasmBinary = options.processorOptions && options.processorOptions.wasmBinary;
        this._boot(wasmBinary);
    }

    async _boot(wasmBinary) {
        try {
            if (typeof createSurgeModule !== 'function') {
                throw new Error('surge-wam-dsp.js was not loaded into the worklet scope');
            }
            const Module = await createSurgeModule({ wasmBinary });
            this.Module = Module;
            this.bridge = new Module.SurgeBridge(sampleRate);
            this.blockSize = this.bridge.blockSize();
            // apply any parameter state that arrived before boot finished
            this.bridge.setOscType(this.params.osc_type | 0);
            // populate the filter-type choice list from the engine
            const nFilters = this.bridge.numFilterTypes();
            const choices = [];
            for (let i = 0; i < nFilters; i++) choices.push(this.bridge.filterTypeName(i));
            PARAM_INFO.filter_type.choices = choices;
            PARAM_INFO.filter_type.maxValue = nFilters - 1;
            this.params.filter_type = this.bridge.getFilterType();
            // sync engine-backed parameter defaults from the engine's init patch
            for (const pid in PARAM_INFO) {
                const info = PARAM_INFO[pid];
                if (info.engineIndex !== undefined) {
                    this.params[pid] = this.bridge.getParamNorm(info.engineIndex);
                }
            }
            this.ready = true;
            this.port.postMessage({ verb: 'ready', payload: { blockSize: this.blockSize, sampleRate } });
        } catch (err) {
            this.port.postMessage({ verb: 'error', payload: String(err && err.stack || err) });
        }
    }

    _onMessage(e) {
        const { id, verb, payload } = e.data || {};
        switch (verb) {
            case 'scheduleEvents':
                for (const ev of payload) this._scheduleEvent(ev);
                break;
            case 'clearEvents':
                this.pending.length = 0;
                if (this.bridge) this.bridge.allNotesOff();
                break;
            case 'getParameterInfo': {
                const ids = payload && payload.length ? payload : Object.keys(PARAM_INFO);
                const info = {};
                for (const pid of ids) if (PARAM_INFO[pid]) info[pid] = PARAM_INFO[pid];
                this.port.postMessage({ id, payload: info });
                break;
            }
            case 'getParameterValues': {
                const ids = (payload.ids && payload.ids.length) ? payload.ids : Object.keys(PARAM_INFO);
                const out = {};
                for (const pid of ids) {
                    if (!PARAM_INFO[pid]) continue;
                    const info = PARAM_INFO[pid];
                    // Engine-backed params are read live, so values track patch
                    // loads and any internal changes; others come from our cache.
                    let value;
                    if (info.engineIndex !== undefined && this.bridge) {
                        value = this.bridge.getParamNorm(info.engineIndex);
                    } else if (pid === 'filter_type' && this.bridge) {
                        value = this.bridge.getFilterType();
                    } else {
                        value = this.params[pid];
                    }
                    if (payload.normalized) {
                        value = (value - info.minValue) / (info.maxValue - info.minValue);
                    }
                    out[pid] = { id: pid, value, normalized: !!payload.normalized };
                }
                this.port.postMessage({ id, payload: out });
                break;
            }
            case 'setParameterValues': {
                for (const pid in payload) this._setParam(pid, payload[pid].value, payload[pid].normalized);
                this.port.postMessage({ id, payload: true });
                break;
            }
            case 'loadPatch': {
                let ok = false;
                if (this.bridge) {
                    try { ok = this.bridge.loadPatchBytes(payload.name || '', new Uint8Array(payload.bytes)); }
                    catch (err) { ok = false; }
                }
                this.port.postMessage({ id, payload: { ok, name: this.bridge ? this.bridge.patchName() : '',
                                                       author: this.bridge ? this.bridge.patchAuthor() : '',
                                                       category: this.bridge ? this.bridge.patchCategory() : '' } });
                break;
            }
            case 'destroy':
                this.ready = false;
                this.bridge = null;
                break;
        }
    }

    _setParam(pid, value, normalized) {
        const info = PARAM_INFO[pid];
        if (!info) return;
        if (normalized) value = info.minValue + value * (info.maxValue - info.minValue);
        value = Math.min(info.maxValue, Math.max(info.minValue, value));
        this.params[pid] = value;
        if (info.engineIndex !== undefined) {
            // engine params store 0..1; minValue/maxValue are 0/1 so value is 0..1
            if (this.bridge) this.bridge.setParamNorm(info.engineIndex, value);
        } else if (pid === 'osc_type') {
            if (this.bridge) this.bridge.setOscType(value | 0);
        } else if (pid === 'filter_type') {
            if (this.bridge) this.bridge.setFilterType(value | 0);
        } else if (pid === 'volume') {
            this.gain = value;
        }
    }

    _scheduleEvent(ev) {
        if (!ev) return;
        if (ev.type === 'wam-midi' && ev.data && ev.data.bytes) {
            this.pending.push({ time: ev.time || 0, bytes: ev.data.bytes });
        } else if (ev.type === 'wam-automation' && ev.data) {
            this._setParam(ev.data.id, ev.data.value, ev.data.normalized);
        }
    }

    _applyMidi(bytes) {
        if (!this.bridge) return;
        const status = bytes[0] & 0xf0;
        const chan = bytes[0] & 0x0f;
        const d1 = bytes[1] | 0;
        const d2 = bytes[2] | 0;
        switch (status) {
            case 0x90: // note on (vel 0 => note off)
                if (d2 > 0) this.bridge.noteOn(chan, d1, d2);
                else this.bridge.noteOff(chan, d1, 0);
                break;
            case 0x80: // note off
                this.bridge.noteOff(chan, d1, d2);
                break;
            case 0xb0: // control change
                this.bridge.controller(chan, d1, d2);
                break;
            case 0xe0: // pitch bend: 14-bit, center 8192 -> Surge expects signed
                this.bridge.pitchBend(chan, ((d2 << 7) | d1) - 8192);
                break;
            default:
                break;
        }
    }

    process(_inputs, outputs, _params) {
        const out = outputs[0];
        if (!this.ready || !this.bridge || !out || out.length === 0) return true;

        try {
            const frames = out[0].length; // typically 128
            const quantumEnd = currentTime + frames / sampleRate;

            // Apply all MIDI events due within (or before) this quantum. Timing is
            // at quantum granularity - fine for a live keyboard; Surge's own
            // 32-sample block rounding already caps sub-quantum accuracy.
            if (this.pending.length) {
                const due = [];
                const still = [];
                for (const ev of this.pending) {
                    if (ev.time <= quantumEnd) due.push(ev);
                    else still.push(ev);
                }
                if (due.length) {
                    due.sort((a, b) => a.time - b.time);
                    for (const ev of due) this._applyMidi(ev.bytes);
                    this.pending = still;
                }
            }

            const view = this.bridge.render(frames); // interleaved stereo, len frames*2
            const L = out[0];
            const R = out.length > 1 ? out[1] : null;
            const g = this.gain;
            for (let i = 0; i < frames; i++) {
                L[i] = view[i * 2] * g;
                if (R) R[i] = view[i * 2 + 1] * g;
            }
        } catch (err) {
            // Never throw out of the audio callback (that would silence the node
            // permanently). Report the first failure and continue with silence.
            if (!this._reportedError) {
                this._reportedError = true;
                this.port.postMessage({ verb: 'error', payload: 'process(): ' + String(err && err.message || err) });
            }
        }
        return true;
    }
}

registerProcessor('surge-wam-processor', SurgeWamProcessor);
