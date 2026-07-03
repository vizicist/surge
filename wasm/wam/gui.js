/*
 * Surge XT WAM - GUI (main thread).
 *
 * createGui() returns this element. Controls are built dynamically from the
 * module's WAM parameter list (getParameterInfo): the `osc_type` choice becomes
 * a dropdown, every other parameter a slider. A small keyboard emits WAM MIDI
 * events. All edits route through the module's SurgeWamNode.
 */

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = [1, 3, 6, 8, 10];

const CSS = `
:host { display:block; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:#e8eaed; }
.wrap { background:#23272f; border:1px solid #333842; border-radius:12px; padding:16px 18px; width:560px; max-width:100%; }
.title { font-weight:650; font-size:15px; margin-bottom:14px; }
.title span { color:#ff9500; }
.grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px 22px; margin-bottom:16px; }
.ctl { display:flex; flex-direction:column; gap:5px; }
.ctl .lbl { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#9aa0a6; display:flex; justify-content:space-between; }
.ctl .lbl .num { color:#cfd3d8; font-variant-numeric:tabular-nums; }
select { font:inherit; color:#e8eaed; background:#2c313a; border:1px solid #3a4049; border-radius:8px; padding:7px 9px; }
input[type=range] { width:100%; accent-color:#4a9eff; }
.kb { position:relative; height:110px; display:inline-flex; user-select:none; touch-action:none; margin-top:4px; }
.wkey { position:relative; width:30px; height:110px; background:#f4f4f4; border:1px solid #999; border-radius:0 0 5px 5px; margin-left:-1px; }
.wkey.down { background:linear-gradient(#ffd9a0,#ff9500); }
.bkey { position:absolute; top:0; width:19px; height:68px; background:#2a2a2a; border:1px solid #000; border-radius:0 0 4px 4px; z-index:2; }
.bkey.down { background:linear-gradient(#c47400,#ff9500); }
.hint { color:#9aa0a6; font-size:12px; margin-top:12px; }
`;

export async function createSurgeGui(module) {
    const node = module.audioNode;
    const info = await node.getParameterInfo();
    const values = await node.getParameterValues(false);

    const el = document.createElement('div');
    const root = el.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `<div class="title"><span>Surge XT</span> · Web Audio Module</div><div class="grid"></div><div class="kb"></div><div class="hint">Click keys to play. MIDI + parameters route through the WAM event API.</div>`;
    root.appendChild(wrap);
    const grid = wrap.querySelector('.grid');

    const setParam = (id, value) => {
        node.setParameterValues({ [id]: { id, value, normalized: false } });
    };

    // Build a control per parameter, in declaration order.
    for (const id of Object.keys(info)) {
        const p = info[id];
        const cur = values[id] ? values[id].value : p.defaultValue;
        const ctl = document.createElement('div');
        ctl.className = 'ctl';

        if (p.type === 'choice') {
            ctl.innerHTML = `<div class="lbl"><span>${p.label}</span></div>`;
            const sel = document.createElement('select');
            (p.choices || []).forEach((name, i) => {
                const o = document.createElement('option');
                o.value = i; o.textContent = name; sel.appendChild(o);
            });
            sel.value = String(Math.round(cur));
            sel.addEventListener('change', () => setParam(id, Number(sel.value)));
            ctl.appendChild(sel);
        } else {
            const lbl = document.createElement('div');
            lbl.className = 'lbl';
            const num = `<span class="num">${cur.toFixed(2)}</span>`;
            lbl.innerHTML = `<span>${p.label}</span>${num}`;
            const range = document.createElement('input');
            range.type = 'range';
            range.min = p.minValue; range.max = p.maxValue;
            range.step = (p.maxValue - p.minValue) / 1000;
            range.value = cur;
            range.addEventListener('input', () => {
                const v = Number(range.value);
                setParam(id, v);
                lbl.querySelector('.num').textContent = v.toFixed(2);
            });
            ctl.appendChild(lbl);
            ctl.appendChild(range);
        }
        grid.appendChild(ctl);
    }

    // 2-octave keyboard
    const kb = wrap.querySelector('.kb');
    const baseOctave = 4, whiteW = 30, octaves = 2;
    let whiteCount = 0;
    for (let o = 0; o < octaves; o++) for (const s of WHITE) {
        const k = document.createElement('div');
        k.className = 'wkey'; k.dataset.semi = o * 12 + s; kb.appendChild(k); whiteCount++;
    }
    for (let o = 0; o < octaves; o++) for (const bs of BLACK) {
        const leftWhite = WHITE.filter(w => w < bs).length - 1 + o * 7;
        const k = document.createElement('div');
        k.className = 'bkey'; k.dataset.semi = o * 12 + bs;
        k.style.left = (leftWhite * whiteW + whiteW - 10) + 'px';
        kb.appendChild(k);
    }
    kb.style.width = (whiteCount * whiteW) + 'px';

    const held = new Set();
    const midiFor = (semi) => (baseOctave + 1) * 12 + Number(semi);
    const paint = (semi, on) => {
        const k = kb.querySelector(`[data-semi="${semi}"]`);
        if (k) k.classList.toggle('down', on);
    };
    const down = (semi) => {
        const m = midiFor(semi);
        if (held.has(m)) return;
        held.add(m); node.noteOn(m, 100); paint(semi, true);
    };
    const up = (semi) => {
        const m = midiFor(semi);
        if (!held.has(m)) return;
        held.delete(m); node.noteOff(m); paint(semi, false);
    };
    kb.addEventListener('pointerdown', e => {
        const t = e.target.closest('[data-semi]'); if (!t) return;
        e.preventDefault(); t.setPointerCapture?.(e.pointerId); down(t.dataset.semi);
    });
    kb.addEventListener('pointerup', e => {
        const t = e.target.closest('[data-semi]'); if (t) up(t.dataset.semi);
    });
    kb.addEventListener('pointerleave', e => {
        const t = e.target.closest('[data-semi]'); if (t) up(t.dataset.semi);
    });

    return el;
}
