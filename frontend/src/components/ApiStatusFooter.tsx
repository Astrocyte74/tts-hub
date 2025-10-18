import { useMemo, useState } from 'react';
import type { MetaResponse } from '../types';

function computeApiBase(meta: MetaResponse): string {
  const prefix = meta.api_prefix ? `/${meta.api_prefix.replace(/^\/+|\/+$/g, '')}` : '';
  const baseEnv = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  if (baseEnv) return `${baseEnv}${prefix}`;
  // Same-origin
  return `${prefix || '/api'}`;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url, window.location.href).host || null;
  } catch {
    return null;
  }
}

export function ApiStatusFooter({ meta }: { meta: MetaResponse | undefined }) {
  const [open, setOpen] = useState(false);

  const apiBase = useMemo(() => (meta ? computeApiBase(meta) : ''), [meta]);
  const port = meta?.port ?? 7860;
  const prefix = meta?.api_prefix ?? 'api';

  const localUrl = `http://127.0.0.1:${port}/${prefix}`;
  const bindUrl = meta?.urls?.bind ?? `http://${window.location.hostname}:${port}/${prefix}`;
  const lanUrl = meta?.urls?.lan ?? undefined;
  const wgUrl = meta?.urls?.wg ?? undefined;

  const resolvedApiHost = hostnameOf(apiBase) ?? window.location.host;

  return (
    <div id="api-status-footer" className="panel panel--compact" style={{ marginTop: 12 }}>
      <div className="panel__header panel__header--dense" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <h3 className="panel__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>▶</span>
          API & CLI
        </h3>
        <p className="panel__meta">Connected to {resolvedApiHost}</p>
      </div>
      {open ? (
        <div className="dialog-stack" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <p className="panel__meta">Use these URLs from this Mac, your LAN, or WireGuard peers.</p>
            <ul style={{ margin: '8px 0 0 18px', lineHeight: 1.7 }}>
              <li><code>API (this UI uses)</code>: <code>{apiBase}</code></li>
              <li><code>Local</code>: <code>{localUrl}</code></li>
              <li><code>Bind</code>: <code>{bindUrl}</code></li>
              {lanUrl ? <li><code>LAN</code>: <code>{lanUrl}</code></li> : null}
              {wgUrl ? <li><code>WireGuard</code>: <code>{wgUrl}</code></li> : null}
            </ul>
          </div>
          <div style={{ marginTop: 6 }}>
            <p className="panel__meta">CLI on this Mac</p>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(2,6,23,0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)' }}>
{`export TTSHUB_API_BASE=${wgUrl ?? lanUrl ?? bindUrl}
python3 kokoroB/cli/tts_cli.py menu`}
            </pre>
          </div>
          <div>
            <p className="panel__meta">From a NAS or another device</p>
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(2,6,23,0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)' }}>
{`# List favorites
curl "${wgUrl ?? lanUrl ?? bindUrl}/favorites"

# Synthesize by favorite slug
curl -X POST -H "Content-Type: application/json" \\
  -d '{"favoriteSlug":"my-voice","text":"Hello from NAS"}' \\
  "${wgUrl ?? lanUrl ?? bindUrl}/synthesise"`}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
