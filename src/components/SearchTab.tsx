/**
 * SearchTab — public YouTube videos for a few words (doc 151 §4), with the
 * person's own key. The search runs on Enter or the button, never while
 * typing: each search spends 100 units of a 10 000-a-day quota.
 */
import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { runSearch, useAccount } from '../lib/account';
import type { Item } from '../lib/library';
import * as player from '../lib/player';
import { showTab, useScreen } from '../lib/screen';
import { ItemRow } from './ItemRow';
import { Section } from './Section';

export function SearchTab() {
  const { t } = useI18n();
  const screen = useScreen();
  const account = useAccount();
  const now = player.usePlayer();
  const [query, setQuery] = useState(screen.search.query);
  const [live, setLive] = useState(screen.search.live);
  const s = screen.search;
  const items: Item[] = s.results.map((h) => ({ kind: 'yt', videoId: h.id, title: h.title, ...(h.channel ? { channel: h.channel } : {}) }));
  const current = player.current(now);
  const noKey = account.key !== null && !account.key.present;

  const go = () => {
    if (!query.trim()) return;
    runSearch(query, live).catch((err: unknown) => console.warn('[youtube] search refused:', err instanceof Error ? err.message : err));
  };

  return (
    <Section id="search" className="full" title={s.status === 'ready' && s.query ? t('search.resultsFor', { query: s.query }) : t('tabs.search')}>
      <div className="yt-row">
        <input type="search" value={query} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        <button className={`chip-tile glass${live ? ' chosen' : ''}`} aria-pressed={live} onClick={() => setLive(!live)}>{t('search.liveOnly')}</button>
        <button className="primary" disabled={!query.trim() || s.status === 'loading'} onClick={go}>{t('search.go')}</button>
      </div>
      {noKey && <div className="yt-note">{t('code.KEY_MISSING')} <button className="link" onClick={() => showTab('settings')}>{t('tabs.settings')}</button></div>}
      {s.status === 'loading' && <div className="yt-muted">{t('common.loading')}</div>}
      {s.status === 'error' && s.error && <div className="yt-error">{t(`code.${s.error}`)}</div>}
      {s.status === 'ready' && !s.results.length && <div className="yt-muted">{t('search.none', { query: s.query })}</div>}
      <div className="yt-list">
        {s.results.map((h, i) => (
          <ItemRow
            key={h.id}
            item={items[i]!}
            thumbnail={h.thumbnail}
            sub={`${i + 1}. ${h.channel}`}
            live={h.live}
            playing={current?.kind === 'yt' && current.videoId === h.id}
            onPlay={() => player.playQueue(items, i, { kind: 'search', query: s.query })}
          />
        ))}
      </div>
    </Section>
  );
}
