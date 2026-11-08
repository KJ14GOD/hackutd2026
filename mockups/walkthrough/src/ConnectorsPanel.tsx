import { useEffect, useState } from 'react';
import type { Connector } from '../server/connectorTypes';
import { ConnectorIcon } from './connectorIcons';

/**
 * Step 1: which sources Theseus can use, checked live. A source that isn't connected is skipped by the
 * pipeline (ownership and document lookups only use what's here), so this list is also the honest answer to
 * "where did that come from".
 */
export function ConnectorsPanel() {
  const [list, setList] = useState<Connector[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  function load(refresh: boolean) {
    setRefreshing(refresh);
    fetch(`/api/connectors${refresh ? '?refresh=1' : ''}`)
      .then((r) => (r.ok ? (r.json() as Promise<Connector[]>) : Promise.reject(new Error(r.statusText))))
      .then((l) => { setList(l); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRefreshing(false));
  }

  // Checks the sources once on open; each check calls that source's API, so this syncs with outside systems.
  useEffect(() => { load(false); }, []);

  if (error) return <p className="signin-error">Couldn’t check the connectors: {error}</p>;
  if (!list) return <p className="map-hint">Checking each source…</p>;
  const connected = list.filter((c) => c.connected).length;
  return (
    <div className="connectors">
      <div className="connectors-head">
        <span>{connected} of {list.length} connected. Anything not connected is skipped, never faked.</span>
        <button type="button" className="link-btn" onClick={() => load(true)} disabled={refreshing}>{refreshing ? 'Checking…' : 'Check again'}</button>
      </div>
      {list.map((c) => (
        <div key={c.id} className={c.connected ? 'connector on' : 'connector'}>
          <b><ConnectorIcon id={c.id} size={15} />{c.name}</b>
          <span className="connector-state">{c.connected ? 'Connected' : 'Not connected'}</span>
          <span className="connector-detail">{c.connected ? c.detail : `${c.detail}. Needs: ${c.needs}`}</span>
          <span className="connector-use">{c.usedFor}</span>
        </div>
      ))}
    </div>
  );
}
