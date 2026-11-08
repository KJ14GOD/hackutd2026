// Monochrome marks for each connector, drawn in currentColor so they follow the text color around them.
// Brand marks come from Simple Icons (CC0); the HR directory uses a plain people glyph.
import { siConfluence, siGithub, siJira, siNotion, siNvidia, siSlack } from 'simple-icons';

export type ConnectorIconId = 'github' | 'slack' | 'jira' | 'notion' | 'confluence' | 'hr' | 'hr-directory' | 'nemotron';

const BRAND: Partial<Record<ConnectorIconId, string>> = {
  github: siGithub.path, slack: siSlack.path, jira: siJira.path, notion: siNotion.path, confluence: siConfluence.path, nemotron: siNvidia.path,
};

/** Two people: the HR directory (no brand). */
const PEOPLE = 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5zm8-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm1 2h-.6A6.3 6.3 0 0 1 19 18v3h4v-3c0-2.6-2.2-4.6-5-5z';

export function ConnectorIcon({ id, size = 16, title }: { id: ConnectorIconId; size?: number; title?: string }) {
  const path = BRAND[id] ?? PEOPLE;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} className="connector-icon">
      {title && <title>{title}</title>}
      <path d={path} />
    </svg>
  );
}
