import { useEffect, useRef, useState } from 'react';
import { DATA_H, PAD, type Box, type GraphModel } from './graphModel';

interface View { x: number; y: number; k: number }

/** Where the line from a box's center toward (tx, ty) leaves the box. */
function exitPoint(b: Box, tx: number, ty: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy;
  const t = Math.min(Math.abs(b.w / 2 / (dx || 1e-6)), Math.abs(b.h / 2 / (dy || 1e-6)));
  return { x: cx + dx * t, y: cy + dy * t, vertical: Math.abs(dy * (b.w / 2)) > Math.abs(dx * (b.h / 2)) };
}

function fit(model: GraphModel, w: number, h: number): View {
  const k = Math.min(1.1, Math.max(0.2, Math.min((w - 80) / model.width, (h - 120) / model.height)));
  return { k, x: (w - model.width * k) / 2, y: (h - model.height * k) / 2 + 20 };
}

/**
 * The real code map: drag or scroll to move, pinch or the buttons to zoom, hover to trace,
 * click a program or dataset to open its details.
 */
const KINDS = [
  { rel: 'calls', label: 'Calls', hint: 'CALL: runs another program and comes back' },
  { rel: 'transfers', label: 'Hands off', hint: 'CICS XCTL: passes control to another screen program' },
  { rel: 'links', label: 'Links', hint: 'CICS LINK: runs another program and comes back' },
  { rel: 'read', label: 'Reads data', hint: 'Reads a dataset or table' },
  { rel: 'write', label: 'Writes data', hint: 'Adds, changes or deletes records' },
] as const;

export function GraphCanvas({ model, selected, onSelect }: { model: GraphModel; selected: string | null; onSelect: (id: string | null) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const counts = Object.fromEntries(KINDS.map((k) => [k.rel, model.links.filter((l) => l.rel === k.rel).length]));
  const toggle = (rel: string) => setHidden((h) => { const n = new Set(h); if (n.has(rel)) n.delete(rel); else n.add(rel); return n; });
  const [view, setView] = useState<View | null>(null);
  const [drag, setDrag] = useState<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Fit once the canvas has a size; the size comes from layout, which only the DOM knows.
  useEffect(() => {
    const el = boxRef.current;
    if (el && !view) setView(fit(model, el.clientWidth, el.clientHeight));
  }, [model, view]);

  // Scrolling pans instead of scrolling the page, so the listener can't be passive.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        if (!v) return v;
        if (!e.ctrlKey && !e.metaKey) return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
        const k = Math.min(2.5, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoom = (f: number) => setView((v) => {
    const el = boxRef.current;
    if (!v || !el) return v;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2, k = Math.min(2.5, Math.max(0.15, v.k * f));
    return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
  });

  const focus = hover ?? selected;
  const linked = new Set<string>();
  if (focus) for (const l of model.links) if (l.from === focus || l.to === focus) { linked.add(l.from); linked.add(l.to); }
  const dim = (id: string) => (focus ? (id === focus || linked.has(id) ? ' lit' : ' dim') : '');

  return (
    <div ref={boxRef} className={drag ? 'graph dragging' : 'graph'}
      onPointerDown={(e) => {
        if (!view) return;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        setDrag({ px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false });
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--gx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--gy', `${e.clientY - r.top}px`);
        if (!drag) return;
        const moved = drag.moved || Math.hypot(e.clientX - drag.px, e.clientY - drag.py) > 4;
        if (moved !== drag.moved) setDrag({ ...drag, moved });
        setView((v) => (v ? { ...v, x: drag.x + e.clientX - drag.px, y: drag.y + e.clientY - drag.py } : v));
      }}
      onPointerUp={(e) => {
        // A click (not a drag) selects whatever is under the pointer, or clears the selection.
        if (drag && !drag.moved) {
          const target = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-id]');
          onSelect(target?.getAttribute('data-id') ?? null);
        }
        setDrag(null);
      }}>
      <div className="graph-spot" aria-hidden />
      {view && (
        <svg className="graph-svg">
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {model.groups.map((g, i) => (
              <g key={g.id} className={`frame on${focus ? ' dim' : ''}`} style={{ animationDelay: `${i * 70}ms` }}>
                <rect x={g.x} y={g.y + 4} width={g.w} height={g.h} rx={14} />
                <text x={g.x + 18} y={g.y + PAD + 10} className="frame-name">{g.name}</text>
                <text x={g.x + g.w - 18} y={g.y + PAD + 10} textAnchor="end" className="frame-note">{g.count} programs</text>
              </g>
            ))}
            {model.links.map((l, i) => {
              if (hidden.has(l.rel)) return null;
              const A = model.boxes.get(l.from)!, B = model.boxes.get(l.to)!;
              const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
              const s = exitPoint(A, bc.x, bc.y), t = exitPoint(B, ac.x, ac.y);
              const bend = Math.max(40, Math.hypot(t.x - s.x, t.y - s.y) * 0.35);
              const c1 = s.vertical ? { x: s.x, y: s.y + Math.sign(t.y - s.y) * bend } : { x: s.x + Math.sign(t.x - s.x) * bend, y: s.y };
              const c2 = t.vertical ? { x: t.x, y: t.y + Math.sign(s.y - t.y) * bend } : { x: t.x + Math.sign(s.x - t.x) * bend, y: t.y };
              const on = focus && (l.from === focus || l.to === focus);
              const cls = `edge draw k-${l.rel}${l.mark ? ` m-${l.mark}` : ''}${focus ? (on ? ' lit' : ' dim') : ''}`;
              return <path key={i} className={cls} markerEnd="url(#arrow)" pathLength={1} style={{ animationDelay: `${400 + (i % 60) * 12}ms` }}
                d={`M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`} />;
            })}
            {[...model.boxes.values()].map((b, i) => b.kind === 'data' ? (
              <g key={b.id} data-id={b.id} className={`datanode${dim(b.id)}${selected === b.id ? ' selected' : ''}`} style={{ animationDelay: `${200 + i * 8}ms` }}
                onPointerEnter={() => setHover(b.id)} onPointerLeave={() => setHover(null)}>
                <rect x={b.x} y={b.y} width={b.w} height={DATA_H} rx={DATA_H / 2} />
                <text x={b.x + b.w / 2} y={b.y + 19} textAnchor="middle" className="data-name">{b.label}</text>
              </g>
            ) : (
              <g key={b.id} data-id={b.id} className={`node${dim(b.id)}${selected === b.id ? ' selected' : ''}`} style={{ animationDelay: `${120 + i * 8}ms` }}
                onPointerEnter={() => setHover(b.id)} onPointerLeave={() => setHover(null)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} />
                <text x={b.x + 14} y={b.y + 20} className="node-name">{b.label}</text>
                <text x={b.x + 14} y={b.y + 35} className="node-meta">{(b.lines ?? 0).toLocaleString()} lines{b.ran ? ' · ran' : ''}</text>
                <rect className="node-bar" x={b.x + b.w - 22} y={b.y + 14} width={8} height={18} rx={2} />
                <rect className="node-fill" x={b.x + b.w - 22} y={b.y + 32 - Math.max(2, ((b.lines ?? 0) / model.maxLines) * 18)} width={8}
                  height={Math.max(2, ((b.lines ?? 0) / model.maxLines) * 18)} rx={2} />
              </g>
            ))}
          </g>
        </svg>
      )}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => { const el = boxRef.current; if (el) setView(fit(model, el.clientWidth, el.clientHeight)); }}>Fit</button>
      </div>
      {model.links.some((l) => l.mark) && (
        <div className="run-legend" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span className="rl-title">From step 3</span>
          <span title="The line that makes this link ran in the sandbox"><svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" className="edge m-confirmed" /></svg>Ran<b>{model.links.filter((l) => l.mark === 'confirmed').length}</b></span>
          <span title="No scenario reached the line that makes this link"><svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" className="edge m-never-fired" /></svg>Never ran<b>{model.links.filter((l) => l.mark === 'never-fired').length}</b></span>
        </div>
      )}
      <div className="link-legend" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        {KINDS.map((k) => (
          <button key={k.rel} type="button" title={k.hint} aria-pressed={!hidden.has(k.rel)}
            className={hidden.has(k.rel) ? 'lk off' : 'lk'} onClick={() => toggle(k.rel)}>
            <svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" className={`edge k-${k.rel}`} /></svg>
            {k.label}<span>{counts[k.rel]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
