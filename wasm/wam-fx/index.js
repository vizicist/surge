/*
 * Surge XT Effects WAM - the WebAudioModule (default export, main thread).
 *
 * An audio-effect WAM: a host loads this module and calls
 * SurgeFXWAM.createInstance(groupId, ctx), connects its own audio into the
 * module's audioNode, and connects the audioNode onward to the speakers.
 *
 * Reuses the shared Surge DSP module and SDK from ../wam/ (the same
 * surge-wam-dsp.{js,wasm} that backs the synth WAM - it also exports
 * SurgeFXBridge), so nothing here is duplicated.
 */

import { WebAudioModule } from '../wam/sdk.js';
import { SurgeFXNode } from './surge-fx-node.js';

const DSP_JS = '../wam/surge-wam-dsp.js';      // shared Emscripten glue
const DSP_WASM = '../wam/surge-wam-dsp.wasm';  // shared engine wasm
const PROCESSOR_JS = './surge-fx-processor.js';

const installed = new WeakSet();

export default class SurgeFXWAM extends WebAudioModule {
    constructor(groupId, audioContext) {
        super(groupId, audioContext);
        this.processorId = 'surge-fx-processor';
    }

    async _installWorklet() {
        const ctx = this.audioContext;
        if (installed.has(ctx)) return;
        // Concatenate the shared DSP glue and our processor into one worklet
        // script (a top-level `var` from a separately-added script isn't reliably
        // visible across scripts in an AudioWorkletGlobalScope).
        const [dspSrc, procSrc] = await Promise.all([
            fetch(new URL(DSP_JS, import.meta.url)).then(r => r.text()),
            fetch(new URL(PROCESSOR_JS, import.meta.url)).then(r => r.text()),
        ]);
        const blob = new Blob([dspSrc, '\n;\n', procSrc], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
            await ctx.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        installed.add(ctx);
    }

    async createAudioNode(initialState) {
        await this._installWorklet();
        const resp = await fetch(new URL(DSP_WASM, import.meta.url));
        const wasmBinary = await resp.arrayBuffer();

        const node = new SurgeFXNode(this, wasmBinary);
        await node.ready;

        if (initialState) {
            if (initialState.effectType !== undefined) await node.setEffectType(initialState.effectType);
            if (initialState.parameterValues) await node.setParameterValues(initialState.parameterValues);
        }
        return node;
    }

    async createGui() {
        const { createSurgeFXGui } = await import('./gui.js');
        return createSurgeFXGui(this);
    }
}
