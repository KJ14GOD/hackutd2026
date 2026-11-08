#!/usr/bin/env node
/* Snapshot Part 2 (Nemotron's read) into the findings the requirements screens show.
 *
 *   node scripts/snapshot-findings.mjs [path/to/part2.json]
 *
 * Default input is ../out/part2.json (written by services/reader at the repo root). Output is
 * src/data/carddemo.findings.json, committed so the UI runs with no backend. Rules and suspected
 * bugs become draft requirements and Nemotron's questions become open questions
 * (src/data/findings.ts). Each cited line carries its code from legacy/carddemo, so the evidence
 * cards show the real source. Never hand-edit the JSON; re-run the script. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const input = resolve(process.argv[2] ?? resolve(repo, 'out/part2.json'))
const output = resolve(here, '../src/data/carddemo.findings.json')
const source = resolve(repo, 'legacy/carddemo')

const KINDS = new Set(['rule', 'defect'])
const part2 = JSON.parse(readFileSync(input, 'utf8'))

const files = new Map()
/** The cited line's code (columns 8-72), or '' when the citation isn't a file:line. */
function excerpt(ref) {
  const m = /^(.+):(\d+)$/.exec(ref)
  if (!m) return ''
  const path = resolve(source, m[1])
  if (!files.has(path)) files.set(path, existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : null)
  const line = files.get(path)?.[Number(m[2]) - 1]
  return line === undefined ? '' : line.slice(7, 72).trimEnd()
}
const cite = (refs) => (refs ?? []).map((ref) => ({ ref, code: excerpt(ref) }))
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10)

const programs = part2.results.map((r) => ({
  program: r.program,
  findings: r.findings
    .filter((f) => KINDS.has(f.kind))
    .map((f) => ({
      id: `REQ-${r.program.toLowerCase()}-${hash(`${f.kind}|${f.summary}|${(f.evidence ?? []).join(',')}`)}`,
      kind: f.kind,
      confidence: f.confidence,
      summary: f.summary,
      cites: cite(f.evidence),
    })),
  questions: r.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, blocks: q.blocks, cites: cite(q.evidence) })),
}))

const snapshot = { model: part2.model, commit: part2.commit, source: input.replace(`${repo}/`, ''), programs }
writeFileSync(output, JSON.stringify(snapshot, null, 1) + '\n')
const count = (k) => programs.reduce((a, p) => a + p.findings.filter((f) => f.kind === k).length, 0)
console.log(`findings: ${count('rule')} rules, ${count('defect')} suspected bugs, ${programs.reduce((a, p) => a + p.questions.length, 0)} questions from ${programs.length} programs -> ${output}`)
