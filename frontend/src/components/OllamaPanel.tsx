import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ollamaTags, ollamaPs, ollamaShow, ollamaGenerate, ollamaChat, ollamaPull } from '../api/client';

export function OllamaPanel() {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState('phi3:latest');
  const [prompt, setPrompt] = useState('Say hello from Kokoro hub');
  const [pullLog, setPullLog] = useState<string>('');
  const [streamPull, setStreamPull] = useState(true);

  const tagsQuery = useQuery({ queryKey: ['ollama-tags'], queryFn: ollamaTags, staleTime: 30_000, enabled: open });
  const psQuery = useQuery({ queryKey: ['ollama-ps'], queryFn: ollamaPs, staleTime: 10_000, enabled: open });

  const generateMutation = useMutation({
    mutationFn: async () => ollamaGenerate({ model, prompt, stream: false }),
  });

  const pullMutation = useMutation({
    mutationFn: async () => {
      setPullLog('');
      if (streamPull) {
        await ollamaPull(model, {
          stream: true,
          onEvent: (line) => setPullLog((prev) => (prev ? prev + '\n' + line : line)),
        });
        return { streamed: true } as any;
      }
      return ollamaPull(model, { stream: false });
    },
  });

  const models = useMemo(() => {
    const payload = tagsQuery.data as any;
    const raw = (payload && (payload.models || payload.data)) || [];
    const names = Array.isArray(raw)
      ? raw
          .map((item: any) => (typeof item === 'string' ? item : item?.name))
          .filter((s: any) => typeof s === 'string' && s)
      : [];
    return names as string[];
  }, [tagsQuery.data]);

  return (
    <div className="panel panel--compact" style={{ marginTop: 12 }}>
      <div className="panel__header panel__header--dense" style={{ cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <h3 className="panel__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>▶</span>
          Ollama
        </h3>
        <p className="panel__meta">Models and quick test</p>
      </div>
      {open ? (
        <div className="dialog-stack" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model (e.g., phi3:latest)"
              style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', minWidth: 240 }}
            />
            <button className="chip-button" onClick={() => tagsQuery.refetch()}>Refresh models</button>
            <label className="chip-button" style={{ gap: 6 }}>
              <input type="checkbox" checked={streamPull} onChange={(e) => setStreamPull(e.target.checked)} /> Stream pull
            </label>
            <button className="chip-button chip-button--accent" onClick={() => pullMutation.mutate()} disabled={pullMutation.isPending}>
              {pullMutation.isPending ? 'Pulling…' : 'Pull model'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Prompt"
              style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(148,163,184,.35)', minWidth: 360, flex: '1 1 360px' }}
            />
            <button className="chip-button" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>Generate</button>
          </div>
          {pullLog ? (
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(2,6,23,0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)', maxHeight: 220, overflow: 'auto' }}>{pullLog}</pre>
          ) : null}
          {generateMutation.data ? (
            <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(2,6,23,0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)' }}>
              {JSON.stringify(generateMutation.data, null, 2)}
            </pre>
          ) : null}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div>
              <p className="panel__meta">Installed models</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {models.map((m) => (
                  <button key={m} className="chip-button" onClick={() => setModel(m)}>{m}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="panel__meta">Status</p>
              <pre style={{ whiteSpace: 'pre-wrap', background: 'rgba(2,6,23,0.6)', padding: 12, borderRadius: 10, border: '1px solid rgba(148,163,184,0.25)' }}>
                {JSON.stringify(psQuery.data ?? { status: 'unknown' }, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

