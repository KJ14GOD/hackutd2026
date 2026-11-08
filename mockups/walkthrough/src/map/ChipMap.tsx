import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapCanvas, type Lens, type MapHandle, type View } from './MapCanvas';
import { blastHighlight, selectionHighlight, type Highlight } from './highlight';
import { ENTRIES, POCKET, PROGRAM, STORE, type Ref } from './carddemo';
import './map.css';

/* CardDemo as a chip floorplan (the web/ mission-control map, ported): shared data files are
 * copper bus lanes, pockets sit in two rows and tap into the lanes they use; clicking a pocket
 * flies in and raises its programs. Lenses recolor the same floorplan. The chapter's own details
 * panel stays the source of truth for links, so a pick here is handed back as a Part 1 node id. */

const LENSES: { id: Lens; label: string; hint: string }[] = [
  { id: 'coupling', label: 'Coupling', hint: 'Where the code is tangled through shared data (1)' },
  { id: 'blast', label: 'Blast radius', hint: 'What to retest if a program changes (2)' },
  { id: 'owners', label: 'Owners', hint: 'Which team each pocket belongs to (3)' },
  { id: 'migration', label: 'Migration', hint: 'What is on Java (nothing yet) (4)' },
];

/** The Part 1 node id a map pick stands for: a program, or the first of a store's datasets the scan knows. */
function nodeIdOf(r: Ref | null, known: Set<string>): string | null {
  if (!r) return null;
  if (r.kind === 'program') return `prog:${r.id}`;
  if (r.kind === 'entry') {
    const e = ENTRIES.find((x) => x.id === r.id);
    return e ? `prog:${e.program}` : null;
  }
  if (r.kind === 'store') return STORE[r.id]?.datasets.map((d) => `data:${d}`).find((id) => known.has(id)) ?? null;
  return null;
}

export function ChipMap({ knownIds, onSelect }: { knownIds: Set<string>; onSelect: (id: string | null) => void }) {
  const mapRef = useRef<MapHandle>(null);
  const [lens, setLens] = useState<Lens>('coupling');
  const [view, setView] = useState<View>('iso');
  const [focus, setFocus] = useState<string | null>(null);
  const [selection, setSelection] = useState<Ref | null>(null);
  const [hover, setHover] = useState<Ref | null>(null);

  const blastSource = selection?.kind === 'program' ? selection.id : selection?.kind === 'entry' ? (ENTRIES.find((e) => e.id === selection.id)?.program ?? null) : null;
  const highlight: Highlight | null = useMemo(() => {
    if (lens === 'blast' && blastSource) return blastHighlight(blastSource);
    if (selection && selection.kind !== 'pocket') return selectionHighlight(selection);
    if (hover && hover.kind !== 'pocket') return selectionHighlight(hover, 'soft');
    return null;
  }, [lens, selection, hover, blastSource]);

  // A pick opens the pocket it lives in; picking nothing steps back out (selection first, then the pocket).
  const pick = useCallback((r: Ref | null) => {
    if (!r) {
      if (selection && !(selection.kind === 'pocket' && focus === selection.id)) { setSelection(null); onSelect(null); return; }
      setSelection(null);
      setFocus(null);
      onSelect(null);
      return;
    }
    if (r.kind === 'pocket') setFocus(r.id);
    else if (r.kind === 'program') setFocus(PROGRAM[r.id].pocket);
    else if (r.kind === 'entry') {
      const e = ENTRIES.find((x) => x.id === r.id);
      if (e) setFocus(PROGRAM[e.program].pocket);
    }
    setSelection(r);
    onSelect(nodeIdOf(r, knownIds));
  }, [selection, focus, knownIds, onSelect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') pick(null);
      else if (e.key >= '1' && e.key <= String(LENSES.length)) setLens(LENSES[Number(e.key) - 1].id);
      else if (e.key.toLowerCase() === 'l') setView((v) => (v === 'iso' ? 'layers' : 'iso'));
      else if (e.key.toLowerCase() === 'f') mapRef.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  return (
    <>
      <MapCanvas ref={mapRef} lens={lens} view={view} focus={focus} selection={selection} hover={hover} highlight={highlight} mig={{}} live={null} onPick={pick} onHover={setHover} />
      <div className="chip-caption">Fig. 01 / CardDemo / dependency map</div>
      <div className="chip-toolbar" role="toolbar" aria-label="Map view">
        <div className="chip-group">
          <button type="button" aria-pressed={view === 'iso'} title="One floor, everything in place (L)" onClick={() => setView('iso')}>Iso</button>
          <button type="button" aria-pressed={view === 'layers'} title="Pull apart: entry points, programs, data (L)" onClick={() => setView('layers')}>Layers</button>
        </div>
        <div className="chip-group">
          {LENSES.map((l) => (
            <button key={l.id} type="button" aria-pressed={lens === l.id} title={l.hint} onClick={() => setLens(l.id)}>{l.label}</button>
          ))}
        </div>
      </div>
      <div className="chip-crumb">
        <button type="button" onClick={() => pick(null)}>CardDemo</button>
        {focus && POCKET[focus] && (
          <>
            <span aria-hidden>›</span>
            <button type="button" onClick={() => pick({ kind: 'pocket', id: focus })}>{POCKET[focus].title}</button>
          </>
        )}
        {selection && selection.kind !== 'pocket' && (
          <>
            <span aria-hidden>›</span>
            <b>{selection.id}</b>
          </>
        )}
      </div>
    </>
  );
}
