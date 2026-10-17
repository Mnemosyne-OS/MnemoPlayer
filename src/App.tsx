/**
 * MnemoPlayer (doc 151) — a visible YouTube player and a music player, the
 * person's own playlists, a search, their channel and their uploads.
 *
 * The player is ALWAYS on screen, beside the work on a wide window and above it
 * on a narrow one: switching tabs never hides what is playing (YouTube's terms,
 * and the person's ears).
 *
 * One window, or five (the exploded view, doc 151 §13 / doc 143): `?widget=`
 * says which part this window is, the same blocks render it, and sync.ts keeps
 * ONE player for all of them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n/useI18n';
import { refreshConnection } from './lib/account';
import { useBoard } from './lib/board';
import { isClosed, isFolded, setClosed, useFolds, type Closable } from './lib/folds';
import { getSoundPrefs } from './lib/soundPrefs';
import { adoptLibrary, setLibraryWrittenListener, startLibrary, useLibrary } from './lib/libraryStore';
import * as player from './lib/player';
import { showTab, TABS, useScreen, type Tab } from './lib/screen';
import { broadcastPort, canPlay, linkWindows, loadHandover, roleOf, saveHandover, type Role } from './lib/sync';
import { ChannelTab } from './components/ChannelTab';
import { ItemRow } from './components/ItemRow';
import { MusicTab } from './components/MusicTab';
import { PlayerView } from './components/PlayerView';
import { PlaylistsTab } from './components/PlaylistsTab';
import { SearchTab } from './components/SearchTab';
import { Section } from './components/Section';
import { SettingsTab } from './components/SettingsTab';
import { SoundGraphHost } from './components/SoundGraphHost';
import { SoundPanel } from './components/SoundPanel';
import { UploadTab } from './components/UploadTab';
import { YoutubeAgentActions } from './components/YoutubeAgentActions';

const ICONS: Record<Tab, string> = { player: '▶', playlists: '☰', search: '⌕', music: '♪', channel: '◉', upload: '⇪', settings: '⚙' };

/** The tabs each window of the exploded view holds; the single window holds them all. */
const ROLE_TABS: Record<Role, readonly Tab[]> = {
  main: TABS,
  player: [],
  sound: [],
  queue: ['player', 'playlists', 'music'],
  search: ['search'],
  channel: ['channel', 'upload', 'settings'],
};

/** What the panels the person can close are called on their reopen icon. */
const CLOSABLE_ICONS: Record<Closable, string> = { sound: '🎚', queue: '≡' };

function QueuePanel({ closable }: { closable: boolean }) {
  const { t } = useI18n();
  const s = player.usePlayer();
  return (
    <Section id="queue" title={t('player.queue')} className="full" {...(closable ? { closable: 'queue' as const } : {})}>
      {!s.queue.length && <div className="yt-muted">{t('player.queueEmpty')}</div>}
      <div className="yt-list">
        {s.queue.map((it, i) => (
          <ItemRow
            key={`${i}:${it.kind === 'yt' ? it.videoId : it.path}`}
            item={it}
            thumbnail={it.kind === 'yt' ? `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg` : null}
            playing={i === s.index}
            onPlay={() => player.playQueue(s.queue, i, s.from ?? { kind: 'single' })}
          />
        ))}
      </div>
    </Section>
  );
}

/** The link to the other windows, for the life of this one. */
function useLink(role: Role): { owner: boolean; ownerGone: boolean } {
  // The single window plays from its first paint (the link confirms it at once); a board window waits to be told.
  const [owner, setOwner] = useState(role === 'main');
  const [ownerGone, setOwnerGone] = useState(false);
  useEffect(() => {
    const port = broadcastPort();
    if (!port) {
      // No channel at all: this window stands alone, and plays if it can.
      setOwner(canPlay(role));
      return undefined;
    }
    const link = linkWindows(role, port, {
      onOwner: setOwner,
      onOwnerGone: setOwnerGone,
      onLibrary: adoptLibrary,
      loadHandover: (reader) => loadHandover(reader),
      saveHandover: () => saveHandover(role),
      wantsBands: () => getSoundPrefs().vizOn && !isFolded('sound'),
    });
    setLibraryWrittenListener((lib) => link.libraryWritten(lib));
    // The page goes (its window closed, a desktop switch): what plays is left for the next window.
    const onHide = () => { if (link.isOwner()) saveHandover(role); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      setLibraryWrittenListener(null);
      link.unlink();
    };
  }, [role]);
  return { owner, ownerGone };
}

function TabButtons({ tabs, role }: { tabs: readonly Tab[]; role: Role }) {
  const { t } = useI18n();
  const screen = useScreen();
  return (
    <>
      {tabs.map((tab) => (
        <button key={tab} className={screen.tab === tab ? 'on' : ''} aria-current={screen.tab === tab ? 'page' : undefined} onClick={() => showTab(tab)}>
          <span aria-hidden>{ICONS[tab]}</span>{tab === 'player' && role !== 'main' ? t('player.queue') : t(`tabs.${tab}`)}
        </button>
      ))}
    </>
  );
}

function BoardError({ board }: { board: ReturnType<typeof useBoard> }) {
  const { t } = useI18n();
  if (!board.error) return null;
  return (
    <div className="yt-row yt-board-error" role="alert">
      <span className="yt-error">{board.error}</span>
      {board.full && <button disabled={board.busy} onClick={board.openHere}>{t('board.openHere')}</button>}
    </div>
  );
}

function TabContent({ tab, queueClosable }: { tab: Tab; queueClosable: boolean }) {
  const folds = useFolds();
  return (
    <>
      {tab === 'player' && !isClosed('queue', folds) && <QueuePanel closable={queueClosable} />}
      {tab === 'playlists' && <PlaylistsTab />}
      {tab === 'search' && <SearchTab />}
      {tab === 'music' && <MusicTab />}
      {tab === 'channel' && <ChannelTab />}
      {tab === 'upload' && <UploadTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}

export default function App() {
  const { t } = useI18n();
  const role = useMemo(() => roleOf(typeof window !== 'undefined' ? window.location.search : ''), []);
  const screen = useScreen();
  const lib = useLibrary();
  const folds = useFolds();
  const board = useBoard();
  const { owner, ownerGone } = useLink(role);

  useEffect(() => {
    startLibrary();
    void refreshConnection();
    // a window of the exploded view opens on its own part
    const first = ROLE_TABS[role][0];
    if (role !== 'main' && first) showTab(first, { fromPeer: true });
  }, [role]);

  // The volume the person left last time, once the library is read (the window that plays only).
  const savedVolume = lib.status === 'ready' ? lib.library.volume : null;
  useEffect(() => {
    if (owner && savedVolume !== null && player.getPlayer().index < 0) player.setVolume(savedVolume);
  }, [savedVolume, owner]);

  const tabs = ROLE_TABS[role];
  const closedPanels = (['sound', 'queue'] as const).filter((c) => isClosed(c, folds) && (c === 'sound' ? role === 'main' : tabs.includes('player')));

  const bar = (
    <nav className="yt-tabs" aria-label={t('app.name')}>
      <TabButtons tabs={tabs} role={role} />
      <span className="yt-tabs-gap" />
      {closedPanels.map((c) => (
        <button key={c} className="icon-btn" title={t(`panels.reopen.${c}`)} aria-label={t(`panels.reopen.${c}`)} onClick={() => setClosed(c, false)}>{CLOSABLE_ICONS[c]}</button>
      ))}
      {ownerGone && <span className="yt-muted yt-gone" role="status">{t('board.ownerGone')}</span>}
      {board.available && role === 'main' && (
        <button className="icon-btn" title={t('board.open')} aria-label={t('board.open')} disabled={board.busy} onClick={board.open}>⧉</button>
      )}
      {board.available && role !== 'main' && (
        <button className="icon-btn" title={t('board.leave')} aria-label={t('board.leave')} disabled={board.busy} onClick={board.leave}>⊡</button>
      )}
    </nav>
  );

  return (
    <div className={`yt-app role-${role}`}>
      {owner && <YoutubeAgentActions />}
      {canPlay(role) && <SoundGraphHost />}
      {bar}
      <BoardError board={board} />
      {role === 'main' ? (
        <main className="yt-body">
          <div className="yt-side">
            <PlayerView stage={owner} />
            {!isClosed('sound', folds) && <SoundPanel />}
          </div>
          <div className="yt-work"><TabContent tab={screen.tab} queueClosable /></div>
        </main>
      ) : (
        <main className="yt-board-body">
          {role === 'player' && <PlayerView stage={owner} />}
          {role === 'sound' && <SoundPanel closable={false} />}
          {tabs.length > 0 && <TabContent tab={tabs.includes(screen.tab) ? screen.tab : tabs[0]!} queueClosable />}
        </main>
      )}
    </div>
  );
}
