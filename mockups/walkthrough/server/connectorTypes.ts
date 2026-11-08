// One row of GET /api/connectors. Kept apart from connectors.ts so pages can import it without Node code.
export interface Connector {
  id: 'github' | 'slack' | 'jira' | 'notion' | 'confluence' | 'hr' | 'nemotron';
  name: string;
  connected: boolean;
  /** Who or what it's connected as, or why it isn't. */
  detail: string;
  /** What Theseus uses it for; when it isn't connected, that part is skipped. */
  usedFor: string;
  /** What it takes to connect it. */
  needs: string;
}
