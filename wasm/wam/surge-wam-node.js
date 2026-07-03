/*
 * Surge XT WAM - the WamNode (main thread).
 *
 * Extends the minimal WamNode base with Surge-specific conveniences: MIDI helper
 * methods that wrap scheduleEvents(), and async loadPatch() that ships raw .fxp
 * bytes to the processor. A `ready` promise resolves once the worklet has booted
 * the Surge engine.
 */

import { WamNode } from './sdk.js';

export class SurgeWamNode extends WamNode {
    constructor(module, wasmBinary) {
        super(module, {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { wasmBinary },
        });

        this.blockSize = 0;
        this.ready = new Promise((resolve, reject) => {
            this._resolveReady = resolve;
            this._rejectReady = reject;
        });

        // Splice engine-lifecycle messages into the base message handler.
        const baseHandler = this.port.onmessage;
        this.port.onmessage = (e) => {
            const { verb, payload } = e.data || {};
            if (verb === 'ready') {
                this.blockSize = payload.blockSize;
                this._resolveReady(payload);
                return;
            }
            if (verb === 'error') {
                this._rejectReady(new Error(payload));
                console.error('[Surge WAM processor]', payload);
                return;
            }
            baseHandler(e);
        };
    }

    // --- MIDI convenience (all wrap WAM 'wam-midi' events) -----------------
    _midi(bytes, time) {
        this.scheduleEvents({ type: 'wam-midi', time: time ?? 0, data: { bytes } });
    }
    noteOn(note, velocity = 100, channel = 0, time) {
        this._midi([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f], time);
    }
    noteOff(note, velocity = 0, channel = 0, time) {
        this._midi([0x80 | (channel & 0x0f), note & 0x7f, velocity & 0x7f], time);
    }
    controlChange(cc, value, channel = 0, time) {
        this._midi([0xb0 | (channel & 0x0f), cc & 0x7f, value & 0x7f], time);
    }
    // bend: signed -8192..8191 (0 = center)
    pitchBend(bend, channel = 0, time) {
        const v = Math.max(0, Math.min(16383, (bend | 0) + 8192));
        this._midi([0xe0 | (channel & 0x0f), v & 0x7f, (v >> 7) & 0x7f], time);
    }
    allNotesOff(channel = 0, time) {
        this.controlChange(123, 0, channel, time);
    }

    // --- patch loading -----------------------------------------------------
    async loadPatch(name, bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const copy = u8.slice(); // transfer a copy so the caller keeps theirs
        return this._call('loadPatch', { name, bytes: copy.buffer }, [copy.buffer]);
    }
}
