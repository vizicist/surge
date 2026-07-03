/*
 * Surge XT Effects WAM - GUI (main thread).
 *
 * An effect selector plus a set of sliders for the current effect's active
 * parameters. The slider set is rebuilt whenever the effect changes (the node
 * dispatches an 'effect-changed' event). All edits route through the SurgeFXNode.
 */

const CSS = `
:host { display:block; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:#e8eaed; }
.wrap { background:#23272f; border:1px solid #333842; border-radius:12px; padding:16px 18px; width:520px; max-width:100%; }
.title { font-weight:650; font-size:15px; margin-bottom:14px; }
.title span { color:#ff9500; }
.top { display:flex; gap:14px; align-items:flex-end; margin-bottom:14px; }
.ctl { display:flex; flex-direction:column; gap:5px; }
.lbl { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#9aa0a6; display:flex; justify-content:space-between; gap:10px; }
.lbl .num { color:#cfd3d8; font-variant-numeric:tabular-nums; }
select { font:inherit; color:#e8eaed; background:#2c313a; border:1px solid #3a4049; border-radius:8px; padding:8px 10px; min-width:180px; }
input[type=range] { width:100%; accent-color:#4a9eff; }
.grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px 22px; }
.empty { color:#9aa0a6; font-size:13px; }
.hint { color:#9aa0a6; font-size:12px; margin-top:14px; }
`;

export async function createSurgeFXGui(module) {
    const node = module.audioNode;

    const el = document.createElement('div');
    const root = el.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="title"><span>Surge XT Effects</span> · Web Audio Module</div>
      <div class="top">
        <div class="ctl">
          <div class="lbl"><span>Effect</span></div>
          <select class="fx"></select>
        </div>
      </div>
      <div class="grid"></div>
      <div class="hint">Feed audio into this module's input; the chosen Surge effect processes it. Parameters below are the effect's own.</div>
    `;
    root.appendChild(wrap);

    // Effect selector
    const fxSel = wrap.querySelector('.fx');
    node.effectNames.forEach((name, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = name; fxSel.appendChild(o);
    });
    fxSel.value = String(node.effectType);
    fxSel.addEventListener('change', () => node.setEffectType(Number(fxSel.value)));

    const grid = wrap.querySelector('.grid');

    const setParam = (id, value) => {
        node.setParameterValues({ [id]: { id, value, normalized: false } });
    };

    async function rebuildParams() {
        grid.innerHTML = '';
        const info = await node.getParameterInfo();
        const values = await node.getParameterValues(false);
        const ids = Object.keys(info).filter(id => id !== 'effect_type');
        if (!ids.length) {
            const d = document.createElement('div');
            d.className = 'empty'; d.textContent = 'This effect has no adjustable parameters.';
            grid.appendChild(d);
            return;
        }
        for (const id of ids) {
            const p = info[id];
            const cur = values[id] ? values[id].value : p.defaultValue;
            const ctl = document.createElement('div');
            ctl.className = 'ctl';
            const lbl = document.createElement('div');
            lbl.className = 'lbl';
            lbl.innerHTML = `<span>${p.label}</span><span class="num">${cur.toFixed(2)}</span>`;
            const range = document.createElement('input');
            range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.001; range.value = cur;
            range.addEventListener('input', () => {
                const v = Number(range.value);
                setParam(id, v);
                lbl.querySelector('.num').textContent = v.toFixed(2);
            });
            ctl.appendChild(lbl); ctl.appendChild(range);
            grid.appendChild(ctl);
        }
    }

    // Rebuild parameter sliders whenever the effect changes.
    node.addEventListener('effect-changed', () => { fxSel.value = String(node.effectType); rebuildParams(); });
    await rebuildParams();

    return el;
}
