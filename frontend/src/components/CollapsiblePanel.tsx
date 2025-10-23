import { useId } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface CollapsiblePanelProps {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  subtitle?: string;
}

export function CollapsiblePanel({ title, storageKey, defaultOpen = true, children, subtitle }: CollapsiblePanelProps) {
  const [open, setOpen] = useLocalStorage<boolean>(storageKey, defaultOpen);
  const regionId = useId();
  const titleId = useId();

  return (
    <section className={`panel panel--collapsible ${open ? 'is-open' : ''}`} role="region" aria-labelledby={titleId}>
      <header className="panel__header" style={{ cursor: 'pointer' }}>
        <button
          type="button"
          className="collapsible__toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen(!open)}
        >
          <span className={`collapsible__chevron ${open ? 'is-open' : ''}`} aria-hidden>
            ▶
          </span>
          <span id={titleId} className="panel__title" style={{ marginLeft: 6 }}>{title}</span>
        </button>
        {subtitle ? <p className="panel__meta">{subtitle}</p> : null}
      </header>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

