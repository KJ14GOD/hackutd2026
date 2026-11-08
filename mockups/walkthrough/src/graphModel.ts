// Turns a Part 1 static map (pass1.json) into something drawable: programs grouped by area and
// mode, online groups on top, batch groups below, and the data they share in a band between them.

export interface P1Node { id: string; kind: string; file?: string; mode?: 'online' | 'batch'; lines?: number }
export interface P1Edge { from: string; to: string; rel: string; evidence: string; via?: string; confidence: string; system: string }
export interface P1Unresolved { program: string; system: string; what: string; token: string; at: string; candidates?: string[] }
export interface Pass1 {
  commit: string;
  inventory: { programs: string[]; copybooks: string[]; jobs: string[] };
  nodes: P1Node[];
  edges: P1Edge[];
  unresolved: P1Unresolved[];
}

export interface Box { id: string; label: string; x: number; y: number; w: number; h: number; kind: 'program' | 'data'; group?: string; lines?: number; mode?: string; ran?: boolean }
export interface Group { id: string; name: string; x: number; y: number; w: number; h: number; mode: string; count: number }
export interface Link { from: string; to: string; rel: string; data: boolean; mark?: 'confirmed' | 'never-fired' }
export interface GraphModel { boxes: Map<string, Box>; groups: Group[]; links: Link[]; maxLines: number; width: number; height: number }

export const NODE_W = 136, NODE_H = 46, GAP_X = 152, GAP_Y = 60, PAD = 22, HEAD = 34, DATA_W = 128, DATA_H = 30;
const GROUP_GAP = 90;
const BAND = 260;

const PROGRAM_RELS = new Set(['calls', 'transfers', 'links']);
const DATA_RELS = new Set(['read', 'write']);

/** "app/app-vsam-mq/cbl/X.cbl" -> "vsam mq"; "app/cbl/X.cbl" -> "core". */
function areaOf(file = ''): string {
  const parts = file.split('/');
  const area = parts.length >= 3 ? parts[parts.length - 3] : '';
  if (!area || area === 'app' || area === '.') return 'core';
  return area.replace(/^app-/, '').replace(/-/g, ' ');
}

const shortData = (id: string) => {
  const name = id.replace(/^data:(db2:|cics:|dd:)?/, '');
  const parts = name.split('.');
  // AWS.M2.CARDDEMO.ACCTDATA.VSAM.KSDS -> ACCTDATA; a db2 table keeps its own name.
  return parts.length > 3 ? parts[3] : parts[parts.length - 1];
};

/** What the Runtime witness found, keyed by `from>to>rel`, plus the programs it ran. */
export interface Marks { links: Map<string, 'confirmed' | 'never-fired'>; ran: Set<string> }

export function buildModel(p: Pass1, marks?: Marks): GraphModel {
  const programs = p.nodes.filter((n) => n.kind === 'program');
  const byGroup = new Map<string, P1Node[]>();
  for (const n of programs) {
    const key = `${n.mode ?? 'batch'}|${areaOf(n.file)}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(n);
  }

  const boxes = new Map<string, Box>();
  const groups: Group[] = [];
  const rowY = { online: 0, batch: 0 };
  let maxOnlineH = 0;
  const groupKeys = [...byGroup.keys()].sort((a, b) => byGroup.get(b)!.length - byGroup.get(a)!.length || a.localeCompare(b));

  // Lay out each row left to right.
  for (const mode of ['online', 'batch'] as const) {
    let x = 0;
    for (const key of groupKeys.filter((k) => k.startsWith(mode))) {
      const members = byGroup.get(key)!.sort((a, b) => a.id.localeCompare(b.id));
      // Roughly square groups: 17 programs become 5 columns, 4 become 2.
      const cols = Math.max(2, Math.ceil(Math.sqrt(members.length * 1.4)));
      const rows = Math.ceil(members.length / cols);
      const w = (cols - 1) * GAP_X + NODE_W + PAD * 2;
      const h = HEAD + (rows - 1) * GAP_Y + NODE_H + PAD * 2;
      const area = key.split('|')[1];
      groups.push({ id: key, name: `${area === 'core' ? 'Core' : area[0].toUpperCase() + area.slice(1)} ${mode}`, x, y: 0, w, h, mode, count: members.length });
      members.forEach((n, i) => {
        boxes.set(n.id, { id: n.id, label: n.id.slice(5), x: x + PAD + (i % cols) * GAP_X, y: PAD + HEAD + Math.floor(i / cols) * GAP_Y, w: NODE_W, h: NODE_H, kind: 'program', group: key, lines: n.lines, mode: n.mode, ran: marks?.ran.has(n.id) });
      });
      x += w + GROUP_GAP;
      if (mode === 'online') maxOnlineH = Math.max(maxOnlineH, h);
    }
  }
  rowY.batch = maxOnlineH + BAND;
  for (const g of groups) if (g.mode === 'batch') {
    g.y = rowY.batch;
    for (const b of boxes.values()) if (b.group === g.id) b.y += rowY.batch;
  }
  // Center the shorter row under the longer one.
  const rowWidth = (mode: string) => Math.max(0, ...groups.filter((g) => g.mode === mode).map((g) => g.x + g.w));
  const widest = Math.max(rowWidth('online'), rowWidth('batch'));
  for (const mode of ['online', 'batch']) {
    const shift = (widest - rowWidth(mode)) / 2;
    for (const g of groups.filter((gg) => gg.mode === mode)) {
      g.x += shift;
      for (const b of boxes.values()) if (b.group === g.id) b.x += shift;
    }
  }

  // Shared data: datasets and tables at least two programs read or write.
  const touching = new Map<string, Set<string>>();
  for (const e of p.edges) {
    if (!DATA_RELS.has(e.rel) || !e.from.startsWith('prog:') || !e.to.startsWith('data:') || !boxes.has(e.from)) continue;
    if (!touching.has(e.to)) touching.set(e.to, new Set());
    touching.get(e.to)!.add(e.from);
  }
  const shared = [...touching].filter(([, progs]) => progs.size >= 2);
  const placed = shared.map(([id, progs]) => {
    const xs = [...progs].map((pid) => boxes.get(pid)!.x + NODE_W / 2);
    return { id, x: xs.reduce((a, b) => a + b, 0) / xs.length };
  }).sort((a, b) => a.x - b.x);
  // Spread them so they never overlap, in two staggered lanes.
  let last = -Infinity;
  placed.forEach((d, i) => {
    d.x = Math.max(d.x, last + DATA_W / 2 + 12);
    last = d.x;
    const lane = i % 2;
    boxes.set(d.id, { id: d.id, label: shortData(d.id), x: d.x - DATA_W / 2, y: maxOnlineH + BAND / 2 - DATA_H + lane * (DATA_H + 22) - 10, w: DATA_W, h: DATA_H, kind: 'data' });
  });

  const links: Link[] = [];
  const seen = new Set<string>();
  for (const e of p.edges) {
    const data = DATA_RELS.has(e.rel);
    if (!(PROGRAM_RELS.has(e.rel) || data) || !boxes.has(e.from) || !boxes.has(e.to)) continue;
    const key = `${e.from}>${e.to}>${data ? e.rel : 'p'}`;
    const mark = marks?.links.get(`${e.from}>${e.to}>${e.rel}`);
    const existing = seen.has(key) ? links.find((l) => `${l.from}>${l.to}>${l.data ? l.rel : 'p'}` === key) : undefined;
    // Several statements can draw one line; it counts as confirmed if any of them ran.
    if (existing) { if (mark === 'confirmed' || (mark && !existing.mark)) existing.mark = mark; continue; }
    seen.add(key);
    links.push({ from: e.from, to: e.to, rel: e.rel, data, mark });
  }

  const all = [...boxes.values()];
  return {
    boxes, groups, links,
    maxLines: Math.max(1, ...programs.map((n) => n.lines ?? 0)),
    width: Math.max(...all.map((b) => b.x + b.w)),
    height: Math.max(...all.map((b) => b.y + b.h)),
  };
}

export const prettyData = shortData;
