/**
 * Section — a panel of MnemoPlayer that folds (doc 151 §12): the header stays,
 * with a chevron button (`aria-expanded`), and the body is not rendered while
 * folded (a folded visualizer runs no frame loop). A closable panel also gets
 * a ✕ in its header; it comes back from its icon in the tab bar.
 *
 * The fold is remembered per viewer (lib/folds.ts) under the section's `id`.
 */
import { useId, type ReactNode } from 'react';
import { useI18n } from '../i18n/useI18n';
import { isFolded, setClosed, setFolded, useFolds, type Closable } from '../lib/folds';

export function Section({ id, title, actions, closable, className = '', keep, children }: {
  id: string;
  title: ReactNode;
  /** Buttons in the header, still there when folded. */
  actions?: ReactNode;
  /** This panel can be closed, not only folded. */
  closable?: Closable;
  className?: string;
  /** Shown under the header even when folded (the player's frame: YouTube's terms keep it visible). */
  keep?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const folds = useFolds();
  const bodyId = useId();
  const folded = isFolded(id, folds);
  const label = folded ? t('common.unfold') : t('common.fold');
  return (
    <section className={`yt-panel glass yt-section${folded ? ' folded' : ''} ${className}`.trim()} data-section={id}>
      <div className="yt-row yt-section-head">
        <button
          className="icon-btn yt-chevron"
          aria-expanded={!folded}
          aria-controls={bodyId}
          title={label}
          aria-label={label}
          onClick={() => setFolded(id, !folded)}
        >
          <span aria-hidden>▾</span>
        </button>
        <h2 className="yt-section-title">{title}</h2>
        {actions}
        {closable && (
          <button className="icon-btn" title={t('common.close')} aria-label={t('common.close')} onClick={() => setClosed(closable, true)}>✕</button>
        )}
      </div>
      {keep}
      <div id={bodyId} className="yt-section-body" hidden={folded}>
        {!folded && children}
      </div>
    </section>
  );
}
