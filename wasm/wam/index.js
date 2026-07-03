/*
 * Surge XT WAM - the WebAudioModule (default export, main thread entry point).
 *
 * A WAM host loads this module and calls SurgeWAM.createInstance(groupId, ctx).
 * We register the two worklet scripts (the Surge DSP glue + our processor) into
 * the context's AudioWorklet, fetch the wasm binary, and build a SurgeWamNode
 * whose processor runs Surge's engine on the audio thread.
 */

import { WebAudioModule } from './sdk.js';
import { SurgeWamNode } from './surge-wam-node.js';

const DSP_JS = './surge-wam-dsp.js';       // Emscripten glue (defines createSurgeModule)
const DSP_WASM = './surge-wam-dsp.wasm';   // the engine
const PROCESSOR_JS = './surge-wam-processor.js';

// Remember which AudioContexts already have our worklet scripts installed, so a
// second instance on the same context doesn't re-add (and re-register) them.
const installed = new WeakSet();

export default class SurgeWAM extends WebAudioModule {
    constructor(groupId, audioContext) {
        super(groupId, audioContext);
        this.processorId = 'surge-wam-processor';
    }

    async _installWorklet() {
        const ctx = this.audioContext;
        if (installed.has(ctx)) return;

        // The processor needs the Emscripten factory (`createSurgeModule`) in its
        // own scope. A top-level `var` from a separately-addModule'd script is NOT
        // reliably visible to another script in the same AudioWorkletGlobalScope
        // (Chromium), so we concatenate the DSP glue and the processor into a
        // single worklet script (via a Blob URL) - then they share one scope.
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

        // Fetch the wasm once on the main thread and hand the bytes to the
        // worklet (AudioWorkletGlobalScope has no fetch of its own).
        const resp = await fetch(new URL(DSP_WASM, import.meta.url));
        const wasmBinary = await resp.arrayBuffer();

        const node = new SurgeWamNode(this, wasmBinary);
        await node.ready;

        if (initialState) {
            if (initialState.parameterValues) await node.setParameterValues(initialState.parameterValues);
        }
        return node;
    }

    async createGui() {
        const { createSurgeGui } = await import('./gui.js');
        return createSurgeGui(this);
    }
}
