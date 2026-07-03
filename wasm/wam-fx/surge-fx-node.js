/*
 * Surge XT Effects WAM - the WamNode (main thread).
 *
 * Extends the shared WamNode with an audio input (numberOfInputs: 1) and an
 * effect-selection helper. Because the effect's parameter set changes when the
 * effect changes, a 'effect-changed' CustomEvent is dispatched so the GUI can
 * rebuild its controls. A `ready` promise resolves once the engine has booted.
 */

import { WamNode } from '../wam/sdk.js';

export class SurgeFXNode extends WamNode {
    constructor(module, wasmBinary) {
        super(module, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { wasmBinary },
        });

        this.blockSize = 0;
        this.effectNames = [];
        this.effectType = 0;
        this.ready = new Promise((resolve, reject) => {
            this._resolveReady = resolve;
            this._rejectReady = reject;
        });

        const baseHandler = this.port.onmessage;
        this.port.onmessage = (e) => {
            const { verb, payload } = e.data || {};
            if (verb === 'ready') {
                this.blockSize = payload.blockSize;
                this.effectNames = payload.effectNames;
                this.effectType = payload.effectType;
                this._resolveReady(payload);
                return;
            }
            if (verb === 'error') {
                this._rejectReady(new Error(payload));
                console.error('[Surge FX processor]', payload);
                return;
            }
            if (verb === 'effect-changed') {
                this.effectType = payload.effectType;
                this.dispatchEvent(new CustomEvent('effect-changed', { detail: payload }));
                return;
            }
            baseHandler(e);
        };
    }

    // Select the active effect by index (0..numEffectTypes-1). Resolves with the
    // new effect's parameter descriptors.
    async setEffectType(index) {
        return this._call('setEffectType', index | 0);
    }
}
