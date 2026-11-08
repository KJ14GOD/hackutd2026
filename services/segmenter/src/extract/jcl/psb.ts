// IMS PSB reader: which segments (DB PCBs) and GSAM files a PSB can touch, and how. Pure.
// PROCOPT letters: G get, I insert, R replace, D delete, A all, L/LS load, GS GSAM get.

export interface PsbFacts {
  segments: { name: string; write: boolean }[];
  gsam: { dbd: string; write: boolean }[]; // GSAM DBD name == DD name in the step's JCL
}

const writes = (procopt: string) => /[AIRDL]/.test(procopt);

export function parsePsb(text: string, fallbackName: string): { name: string; facts: PsbFacts } {
  const facts: PsbFacts = { segments: [], gsam: [] };
  let name = fallbackName;
  let pcb: { type: string; dbd: string; write: boolean } | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.slice(0, 71).toUpperCase();
    if (!line.trim() || line.startsWith('*')) continue;
    const m = line.match(/^(?:\S+\s+)?(PCB|SENSEG|PSBGEN)\s+(\S+)/) ?? line.match(/^\s+(PCB|SENSEG|PSBGEN)\s+(\S+)/);
    if (!m) continue;
    const ops = m[2];
    const get = (k: string) => ops.match(new RegExp(`\\b${k}=\\(?([A-Z0-9$#@]+)`))?.[1] ?? '';
    if (m[1] === 'PCB') {
      pcb = { type: get('TYPE'), dbd: get('DBDNAME'), write: writes(get('PROCOPT')) };
      if (pcb.type === 'GSAM' && pcb.dbd) facts.gsam.push({ dbd: pcb.dbd, write: pcb.write });
    } else if (m[1] === 'SENSEG' && pcb?.type === 'DB') {
      const seg = get('NAME');
      if (seg) facts.segments.push({ name: seg, write: pcb.write });
    } else if (m[1] === 'PSBGEN') {
      name = get('PSBNAME') || name;
    }
  }
  return { name, facts };
}
