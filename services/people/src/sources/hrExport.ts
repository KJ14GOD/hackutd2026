// HR export (Workday-style report). In the demo it's fixtures/org/hr.json; a real deployment reads the
// same report from Workday/BambooHR. Gives people, titles, teams, managers and who has left.
import { readFileSync } from 'node:fs';
import type { SourceResult } from '../types';

interface Worker { workerId: string; firstName: string; lastName: string; workEmail: string; jobTitle: string; supervisoryOrg: string; managerWorkerId: string | null; workerStatus: string }
interface Export { organizations: { id: string; name: string; parent: string | null }[]; workers: Worker[] }

export function hrExport(file: string): SourceResult {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Export;
  const byId = new Map(data.workers.map((w) => [w.workerId, w]));
  return {
    source: 'hr', live: false,
    people: data.workers.map((w) => ({
      id: w.workEmail.toLowerCase(), emails: [w.workEmail.toLowerCase()], name: `${w.firstName} ${w.lastName}`,
      title: w.jobTitle, team: w.supervisoryOrg, active: w.workerStatus === 'active', source: 'hr',
    })),
    teams: data.organizations.map((o) => ({ id: o.id, name: o.name, ...(o.parent ? { parentTeamId: o.parent } : {}), source: 'hr' })),
    reportsTo: data.workers.filter((w) => w.managerWorkerId && byId.has(w.managerWorkerId))
      .map((w) => ({ personId: w.workEmail.toLowerCase(), managerId: byId.get(w.managerWorkerId!)!.workEmail.toLowerCase(), source: 'hr' })),
    owns: [],
  };
}
