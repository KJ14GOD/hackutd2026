// Shared by the document and chat sources: turns "who wrote what about which program" into ownership links.
import { mentions, type ScopeIndex } from '../scopes';
import type { Owns, Signal } from '../types';

export function linksFrom(index: ScopeIndex, args: { personId: string; text: string; signal: Signal; kind: Owns['kind']; source: string; evidence: string; observedAt: string }): Owns[] {
  return mentions(index, args.text).map((target) => ({
    personId: args.personId, target, kind: args.kind, signal: args.signal, weight: 0, source: args.source, evidence: args.evidence, observedAt: args.observedAt,
  }));
}
