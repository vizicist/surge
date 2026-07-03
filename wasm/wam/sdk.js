/*
 * Minimal, dependency-free Web Audio Modules (WAM 2.0) SDK.
 *
 * The official SDK (@webaudiomodules/sdk) pulls in a bundler/npm toolchain. This
 * repo serves everything as plain files over a static server, so we implement
 * just the two base classes the Surge WAM needs, following the public WAM 2.0
 * method contract so a compliant host can drive it:
 *
 *   WebAudioModule - the module/plugin object (main thread).
 *   WamNode        - the audio node (extends AudioWorkletNode) that carries the
 *                    WAM event + parameter plumbing to the processor.
 *
 * See https://github.com/webaudiomodules/api for the full interface.
 */

let INSTANCE_COUNTER = 0;

export class WebAudioModule {
    // Marker the WAM spec uses to recognize a module constructor.
    static get isWebAudioModuleConstructor() {
        return true;
    }

    // Standard entry point: construct, then initialize with optional state.
    static createInstance(groupId, audioContext, initialState) {
        return new this(groupId, audioContext).initialize(initialState);
    }

    constructor(groupId, audioContext) {
        this.groupId = groupId;
        this.audioContext = audioContext;
        this.instanceId = this.moduleId + '_' + INSTANCE_COUNTER++;
        this._audioNode = undefined;
        this._initialized = false;
    }

    get isWebAudioModule() {
        return true;
    }

    // Subclasses set these from their descriptor.json.
    get descriptor() {
        return this._descriptor;
    }
    get moduleId() {
        return this.vendor + '.' + this.name;
    }
    get name() {
        return this._descriptor ? this._descriptor.name : this.constructor.name;
    }
    get vendor() {
        return this._descriptor ? this._descriptor.vendor : 'unknown';
    }

    get audioNode() {
        if (!this._audioNode) throw new Error('audioNode accessed before initialize()');
        return this._audioNode;
    }
    set audioNode(node) {
        this._audioNode = node;
    }

    get initialized() {
        return this._initialized;
    }

    async _loadDescriptor() {
        const url = new URL('./descriptor.json', import.meta.url);
        const resp = await fetch(url);
        this._descriptor = await resp.json();
        return this._descriptor;
    }

    async initialize(state) {
        if (!this._descriptor) await this._loadDescriptor();
        this.audioNode = await this.createAudioNode(state);
        this._initialized = true;
        return this;
    }

    // Subclasses must override to return their WamNode.
    async createAudioNode(_initialState) {
        throw new TypeError('createAudioNode() not implemented');
    }

    async createGui() {
        return undefined;
    }
    destroyGui(_gui) {}
}

export class WamNode extends AudioWorkletNode {
    constructor(module, options = {}) {
        const {
            numberOfInputs = 0,
            numberOfOutputs = 1,
            outputChannelCount = [2],
            processorOptions = {},
        } = options;

        super(module.audioContext, module.processorId || 'surge-wam-processor', {
            numberOfInputs,
            numberOfOutputs,
            outputChannelCount,
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
            processorOptions,
        });

        this.module = module;
        this.instanceId = module.instanceId;
        this._messageId = 1;
        this._pending = new Map();
        this._paramInfo = {};

        this.port.onmessage = (e) => this._onMessage(e);
    }

    // Promise-based request/response over the worklet MessagePort.
    _call(verb, payload, transfer) {
        const id = this._messageId++;
        return new Promise((resolve) => {
            this._pending.set(id, resolve);
            this.port.postMessage({ id, verb, payload }, transfer || []);
        });
    }

    _onMessage(e) {
        const { id, verb, payload } = e.data || {};
        if (id && this._pending.has(id)) {
            this._pending.get(id)(payload);
            this._pending.delete(id);
            return;
        }
        if (verb === 'emit') {
            // processor-originated event (unused for now)
            this.dispatchEvent(new CustomEvent('wam-event', { detail: payload }));
        }
    }

    // --- WAM parameter interface -------------------------------------------
    async getParameterInfo(...ids) {
        return this._call('getParameterInfo', ids);
    }
    async getParameterValues(normalized, ...ids) {
        return this._call('getParameterValues', { normalized, ids });
    }
    async setParameterValues(values) {
        return this._call('setParameterValues', values);
    }

    // --- WAM event interface -----------------------------------------------
    // Events: { type: 'wam-midi' | 'wam-automation', time, data }
    scheduleEvents(...events) {
        this.port.postMessage({ verb: 'scheduleEvents', payload: events });
    }
    clearEvents() {
        this.port.postMessage({ verb: 'clearEvents' });
    }

    // Minimal event-graph stubs (single-WAM host doesn't wire WAMs together).
    connectEvents(_toId, _output) {}
    disconnectEvents(_toId, _output) {}

    destroy() {
        this.port.postMessage({ verb: 'destroy' });
        this.disconnect();
    }
}
