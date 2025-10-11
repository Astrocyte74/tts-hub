import { useMemo } from 'react';
import type { KokoroFavorite, VoiceProfile } from '../types';

interface FavoritesManagerDialogProps {
  isOpen: boolean;
  favorites: KokoroFavorite[];
  voices: VoiceProfile[];
  onClose: () => void;
  onRename: (favorite: KokoroFavorite) => void;
  onDelete: (favorite: KokoroFavorite) => void;
}

export function FavoritesManagerDialog({
  isOpen,
  favorites,
  voices,
  onClose,
  onRename,
  onDelete,
}: FavoritesManagerDialogProps) {
  const voiceMap = useMemo(() => new Map(voices.map((voice) => [voice.id, voice])), [voices]);

  if (!isOpen) {
    return null;
  }

  const handleDelete = (favorite: KokoroFavorite) => {
    if (typeof window === 'undefined') {
      onDelete(favorite);
      return;
    }
    const confirmMessage = `Remove “${favorite.label || favorite.voiceLabel}” from favorites?`;
    if (window.confirm(confirmMessage)) {
      onDelete(favorite);
    }
  };

  const buildAccentLabel = (favorite: KokoroFavorite, voice: VoiceProfile | undefined) => {
    const accentSource = favorite.accent ?? voice?.accent ?? null;
    if (!accentSource) {
      return null;
    }
    const label = `${accentSource.flag ?? ''} ${accentSource.label ?? ''}`.trim();
    return label.length ? label : null;
  };

  return (
    <div className="modal">
      <div className="modal__backdrop" />
      <div className="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="favorites-manager-title">
        <header className="modal__header">
          <h2 id="favorites-manager-title">Manage Kokoro Favorites</h2>
          <p className="modal__subtitle">Rename or remove the Kokoro voices you&apos;ve saved for quick access.</p>
        </header>
        <div className="modal__body favorites-manager">
          {favorites.length ? (
            <ul className="favorites-manager__list">
              {favorites.map((favorite) => {
                const voice = voiceMap.get(favorite.voiceId);
                const accentLabel = buildAccentLabel(favorite, voice);
                return (
                  <li key={favorite.id} className="favorites-manager__item">
                    <div className="favorites-manager__meta">
                      <h3>{favorite.label || voice?.label || favorite.voiceLabel}</h3>
                      <p className="favorites-manager__detail">
                        Voice: <span>{voice?.label ?? favorite.voiceLabel}</span>
                      </p>
                      {accentLabel ? (
                        <p className="favorites-manager__detail">
                          Accent: <span>{accentLabel}</span>
                        </p>
                      ) : null}
                      {favorite.locale ? (
                        <p className="favorites-manager__detail">
                          Locale: <span>{favorite.locale}</span>
                        </p>
                      ) : null}
                      {favorite.notes ? (
                        <p className="favorites-manager__notes">{favorite.notes}</p>
                      ) : null}
                    </div>
                    <div className="favorites-manager__actions">
                      <button
                        type="button"
                        className="modal__button modal__button--ghost"
                        onClick={() => onRename(favorite)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="modal__button modal__button--danger"
                        onClick={() => handleDelete(favorite)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="panel__empty">No favorites saved yet.</p>
          )}
        </div>
        <footer className="modal__footer">
          <button type="button" className="modal__button modal__button--primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
