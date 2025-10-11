import type { ReactNode } from 'react';

interface InfoDialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function InfoDialog({ isOpen, title, onClose, children, footer }: InfoDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="info-dialog-title">
        <header className="modal__header">
          <h2 id="info-dialog-title">{title}</h2>
        </header>
        <div className="modal__body modal__body--scrollable">{children}</div>
        <footer className="modal__footer">
          {footer}
          <button type="button" className="modal__button modal__button--primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
