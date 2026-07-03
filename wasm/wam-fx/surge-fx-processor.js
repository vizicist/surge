/*
 * Surge XT Effects WAM - AudioWorkletProcessor (the audio thread).
 *
 * Runs in the AudioWorkletGlobalScope. The shared Surge DSP module
 * (../wam/surge-wam-dsp.js, concatenated ahead of this script) defines the
 * global `createSurgeModule` factory; we instantiate it and host a SurgeFXBridge
 * that runs incoming audio through one of Surge's 31 effect types.
 *
 * Parameters are dynamic: the exposed set is `effect_type` (a choice) plus the
 * currently selected effect's active parameters (p0..p11), so the list changes
 * when the effect changes.
 */

// AudioWorkletGlobalScope omits Web APIs the Emscripten runtime/engine expect.
// `crypto`/`performance` are getter-only globals here, so define, don't assign.
function installGlobal(name, value) {
    if (typeof globalThis[name] !== 'undefined' && globalThis[name]) return;
    try {
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch (_e) {
        try { globalThis[name] = value; } catch (_e2) { /* nothing */ }
    }
}
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
    installGlobal('crypto', {
        getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0; return arr; },
    });
}
if (typeof globalThis.performance === 'undefined' || !globalThis.performance.now) {
    installGlobal('performance', { now() { return (typeof currentTime === 'number' ? currentTime : 0) * 1000; }, timeOrigin: 0 });
}

class SurgeFXProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.ready = false;
        this.bridge = null;
        this.effectType = 0;
        this.effectNames = [];
        this._reportedError = false;
        this._inBuf = null;

        this.port.onmessage = (e) => this._onMessage(e);
        this._boot(options.processorOptions && options.processorOptions.wasmBinary);
    }

    async _boot(wasmBinary) {
        try {
            if (typeof createSurgeModule !== 'function') {
                throw new Error('surge-wam-dsp.js was not loaded into the worklet scope');
            }
            const Module = await createSurgeModule({ wasmBinary });
            this.Module = Module;
            this.bridge = new Module.SurgeFXBridge(sampleRate);
            this.blockSize = this.bridge.blockSize();
            const n = this.bridge.numEffectTypes();
            for (let i = 0; i < n; i++) this.effectNames.push(this.bridge.effectTypeName(i));
            this.effectType = this.bridge.getEffectType();
            this.ready = true;
            this.port.postMessage({ verb: 'ready', payload: {
                blockSize: this.blockSize, sampleRate,
                effectNames: this.effectNames, effectType: this.effectType,
                params: this._paramInfo(),
            }});
        } catch (err) {
            this.port.postMessage({ verb: 'error', payload: String(err && err.stack || err) });
        }
    }

    // Current effect's parameter descriptors (only active params).
    _paramInfo() {
        const info = {};
        if (!this.bridge) return info;
        const n = this.bridge.numParams();
        for (let j = 0; j < n; j++) {
            if (!this.bridge.paramActive(j)) continue;
            const id = 'p' + j;
            info[id] = {
                id, label: this.bridge.paramName(j), type: 'float',
                defaultValue: this.bridge.getParamNorm(j), minValue: 0, maxValue: 1,
                discreteStep: 0, exponent: 1, choices: [], units: '', paramIndex: j,
            };
        }
        return info;
    }

    // effect_type choice + active params, in WamParameterInfo-ish shape.
    _fullParamInfo() {
        const info = {
            effect_type: {
                id: 'effect_type', label: 'Effect', type: 'choice',
                defaultValue: this.effectType, minValue: 0,
                maxValue: Math.max(0, this.effectNames.length - 1),
                discreteStep: 1, exponent: 1, choices: this.effectNames, units: '',
            },
        };
        Object.assign(info, this._paramInfo());
        return info;
    }

    _onMessage(e) {
        const { id, verb, payload } = e.data || {};
        switch (verb) {
            case 'getParameterInfo':
                this.port.postMessage({ id, payload: this._fullParamInfo() });
                break;
            case 'getParameterValues': {
                const info = this._fullParamInfo();
                const ids = (payload && payload.ids && payload.ids.length) ? payload.ids : Object.keys(info);
                const out = {};
                for (const pid of ids) {
                    if (!info[pid]) continue;
                    let value = this._readParam(pid, info[pid]);
                    if (payload && payload.normalized) {
                        const d = info[pid];
                        value = (value - d.minValue) / (d.maxValue - d.minValue || 1);
                    }
                    out[pid] = { id: pid, value, normalized: !!(payload && payload.normalized) };
                }
                this.port.postMessage({ id, payload: out });
                break;
            }
            case 'setParameterValues':
                for (const pid in payload) this._setParam(pid, payload[pid].value, payload[pid].normalized);
                this.port.postMessage({ id, payload: true });
                break;
            case 'setEffectType':
                if (this.bridge) {
                    this.bridge.setEffectType(payload | 0);
                    this.effectType = this.bridge.getEffectType();
                }
                // reply with the new (dynamic) parameter set
                this.port.postMessage({ id, payload: { effectType: this.effectType, params: this._paramInfo() } });
                this.port.postMessage({ verb: 'effect-changed', payload: { effectType: this.effectType, params: this._paramInfo() } });
                break;
            case 'destroy':
                this.ready = false; this.bridge = null;
                break;
        }
    }

    _readParam(pid, info) {
        if (pid === 'effect_type') return this.effectType;
        if (info.paramIndex !== undefined && this.bridge) return this.bridge.getParamNorm(info.paramIndex);
        return 0;
    }

    _setParam(pid, value, normalized) {
        if (!this.bridge) return;
        if (pid === 'effect_type') {
            let v = value;
            if (normalized) v = Math.round(v * (this.effectNames.length - 1));
            this.bridge.setEffectType(v | 0);
            this.effectType = this.bridge.getEffectType();
            this.port.postMessage({ verb: 'effect-changed', payload: { effectType: this.effectType, params: this._paramInfo() } });
            return;
        }
        // pN parameter (already normalized 0..1)
        const j = parseInt(pid.slice(1), 10);
        if (!isNaN(j)) {
            let v = value;
            if (!normalized) v = Math.min(1, Math.max(0, v)); // our raw range is 0..1
            this.bridge.setParamNorm(j, v);
        }
    }

    process(inputs, outputs, _params) {
        const out = outputs[0];
        if (!this.ready || !this.bridge || !out || out.length === 0) return true;
        try {
            const frames = out[0].length;
            const inp = inputs[0];
            const inL = inp && inp[0] ? inp[0] : null;
            const inR = inp && inp[1] ? inp[1] : (inL || null);

            if (!this._inBuf || this._inBuf.length !== frames * 2) this._inBuf = new Float32Array(frames * 2);
            const buf = this._inBuf;
            if (inL) {
                for (let i = 0; i < frames; i++) { buf[i * 2] = inL[i]; buf[i * 2 + 1] = inR[i]; }
            } else {
                buf.fill(0); // no input connected - still let tails (reverb/delay) ring out
            }

            const view = this.bridge.process(buf, frames); // interleaved stereo out
            const L = out[0], R = out.length > 1 ? out[1] : null;
            for (let i = 0; i < frames; i++) {
                L[i] = view[i * 2];
                if (R) R[i] = view[i * 2 + 1];
            }
        } catch (err) {
            if (!this._reportedError) {
                this._reportedError = true;
                this.port.postMessage({ verb: 'error', payload: 'process(): ' + String(err && err.message || err) });
            }
        }
        return true;
    }
}

registerProcessor('surge-fx-processor', SurgeFXProcessor);
