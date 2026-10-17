/**
 * PlayerView — the visible player (doc 151 §2-§3): the YouTube frame for a
 * video, an <audio> for a song of the music folder, and the controls under it.
 *
 * It FOLLOWS the player store and never decides what plays: the ▶ button and a
 * spoken « play » both change the store, this view makes the frame obey.
 * ⛔ The YouTube frame is never hidden and never smaller than 200 × 200
 * (YouTube's terms); there is no « sound only » mode.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { readTrack } from '../lib/music';
import * as player from '../lib/player';
import { command, embedUrl, listening, playerErrorCode, readEmbedOrigin, readPlayerMessage, rememberSignedInOrigin, SIGN_IN_URL, SIGN_IN_WALL, watchUrl, YT_STATE } from '../lib/ytEmbed';
import { openExternal } from '../lib/host';
import { updateLibrary } from '../lib/libraryStore';
import { BounceBars } from './BounceBars';
import { Section } from './Section';
import { isFolded, useFolds } from '../lib/folds';

/** The player answers `listening` within a second or two; past this it is said, not awaited forever. */
const HANDSHAKE_TRIES = 60;

function YoutubeFrame({ videoId }: { videoId: string }) {
  const s = player.usePlayer();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const ready = useRef(false);
  const lastState = useRef<number | null>(null);
  // Autoplay is read once per video: the first src decides, the effects below follow the store.
  // Read once per frame: a frame keeps the origin its src was built on.
  const origin = useRef(readEmbedOrigin());
  const [src] = useState(() => embedUrl(videoId, window.location.origin, player.getPlayer().playing, player.getPlayer().resumeAt, origin.current));

  const send = (msg: string) => frame.current?.contentWindow?.postMessage(msg, origin.current);

  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      if (ready.current) { window.clearInterval(timer); return; }
      tries += 1;
      if (tries > HANDSHAKE_TRIES) {
        window.clearInterval(timer);
        player.failed('PLAYER_SILENT');
        return;
      }
      send(listening());
    }, 250);
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== origin.current) return;
      const news = readPlayerMessage(e.data);
      if (!news) return;
      if (news.ready && !ready.current) {
        ready.current = true;
        player.resumed(); // the start position was in the src
        const now = player.getPlayer();
        send(command('setVolume', [player.effectiveVolume(now)])); // a frame ready mid-duck starts low
        send(command(now.muted ? 'mute' : 'unMute'));
      }
      if (news.error !== undefined) player.failed(playerErrorCode(news.error));
      // Sent with every infoDelivery while the wall stands: set again only when it would change
      // something (a ▶ pressed on the wall turns `playing` back on, and must be stopped again).
      if (news.signInWall) {
        // From now on the player is the one a sign-in reaches (nocookie never sends it).
        rememberSignedInOrigin();
        const now = player.getPlayer();
        if (now.playing || now.error !== SIGN_IN_WALL) player.failed(SIGN_IN_WALL);
      }
      if (news.state !== undefined) {
        lastState.current = news.state;
        if (news.state === YT_STATE.ended) player.ended();
        // The person used the frame's own buttons: the store follows them.
        else if (news.state === YT_STATE.playing && !player.getPlayer().playing) player.play();
        else if (news.state === YT_STATE.paused && player.getPlayer().playing) player.pause();
      }
      if (news.time !== undefined || news.duration !== undefined) {
        const cur = player.getPlayer();
        const time = news.time !== undefined ? Math.floor(news.time) : cur.position;
        player.progress(time, news.duration !== undefined ? Math.round(news.duration) : cur.duration);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    const st = lastState.current;
    if (s.playing && st !== YT_STATE.playing && st !== YT_STATE.buffering) send(command('playVideo'));
    if (!s.playing && (st === YT_STATE.playing || st === YT_STATE.buffering)) send(command('pauseVideo'));
  }, [s.playing]);

  // The person's volume, or a share of it while the orb listens or speaks.
  const heard = player.effectiveVolume(s);
  useEffect(() => {
    if (!ready.current) return;
    send(command('setVolume', [heard]));
    send(command(s.muted ? 'mute' : 'unMute'));
  }, [heard, s.muted]);

  return (
    <iframe
      ref={frame}
      src={src}
      title="YouTube"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
    />
  );
}

function LocalTrack({ path, title }: { path: string; title: string }) {
  const { t } = useI18n();
  const s = player.usePlayer();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    readTrack(path)
      .then((u) => { if (alive) setUrl(u); })
      .catch((err: unknown) => { if (alive) player.failed(err instanceof Error ? err.message : 'READ_FAILED'); });
    return () => { alive = false; };
  }, [path]);

  useEffect(() => {
    const el = audio.current;
    if (!el || !url) return;
    if (s.playing) el.play().catch((err: unknown) => player.failed(err instanceof Error && err.name === 'NotSupportedError' ? 'FORMAT_UNSUPPORTED' : 'PLAYER_FAILED'));
    else el.pause();
  }, [s.playing, url]);

  const heard = player.effectiveVolume(s);
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.volume = heard / 100;
    el.muted = s.muted;
  }, [heard, s.muted, url]);

  return (
    <div className="yt-local">
      <div style={{ fontSize: 40 }} aria-hidden>♪</div>
      <div className="yt-now">{title}</div>
      {!url && !s.error && <div className="yt-muted">{t('player.loadingTrack')}</div>}
      {url && (
        <audio
          ref={audio}
          src={url}
          controls
          onEnded={() => player.ended()}
          onLoadedMetadata={(e) => {
            // taking over a song another window was playing (doc 151 §13)
            const at = player.getPlayer().resumeAt;
            if (at !== null && at < (Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : Infinity)) e.currentTarget.currentTime = at;
            player.resumed();
          }}
          onTimeUpdate={(e) => player.progress(Math.floor(e.currentTarget.currentTime), Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration) : null)}
          onPause={() => { if (player.getPlayer().playing && !endedNow(audio.current)) player.pause(); }}
          onPlay={() => { if (!player.getPlayer().playing) player.play(); }}
        />
      )}
    </div>
  );
}

/** An <audio> fires `pause` right before `ended`: that one is not the person pausing. */
const endedNow = (el: HTMLAudioElement | null) => !!el && el.ended;

const clock = (sec: number | null) => (sec === null ? '—' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);

/**
 * `stage` is false in a window that does not play (the exploded view, doc 151
 * §13): its controls send commands to the Player window, and where the frame
 * would be it says where the music plays. Never two players at once.
 *
 * The section folds its controls, never its stage (exception to the fold rule,
 * doc 151 §12): YouTube's frame stays visible, at its 200 px minimum when
 * folded, and a song's <audio> stays mounted (unmounting it stops the song).
 */
export function PlayerView({ stage = true }: { stage?: boolean }) {
  const { t } = useI18n();
  const s = player.usePlayer();
  const it = player.current(s);
  const [volume, setVolume] = useState(s.volume);
  // « Réessayer » after a sign-in: a new frame, on the origin that reads it.
  const [retry, setRetry] = useState(0);
  useEffect(() => setVolume(s.volume), [s.volume]);

  const remember = (v: number) => {
    updateLibrary((lib) => ({ ok: true, library: { ...lib, volume: v } }))
      .then((r) => { if (!r.ok && r.code !== 'NOT_READY') console.warn('[youtube] volume not remembered:', r.code); })
      .catch((err: unknown) => console.warn('[youtube] volume not remembered:', err));
  };
  const playLabel = s.playing ? t('player.pause') : t('player.play');
  // folded, the controls go: a ▶/❚❚ stays in the header
  const folded = isFolded('player', useFolds());
  const stageKind = !stage ? 'elsewhere' : !it ? 'empty' : it.kind === 'yt' ? 'yt' : 'local';

  return (
    <Section
      id="player"
      className="yt-player"
      title={<span className="yt-now" title={it?.title}>{it ? it.title : t('player.empty')}</span>}
      actions={(
        <>
          <BounceBars count={12} className="yt-bounce-player" />
          {folded && <button className="icon-btn primary yt-mini-play" title={playLabel} aria-label={playLabel} disabled={!it} onClick={() => player.toggle()}>{s.playing ? '❚❚' : '▶'}</button>}
        </>
      )}
      keep={(
        <div className={`yt-stage ${stageKind}`}>
          {stageKind === 'elsewhere' && <div className="yt-empty yt-elsewhere"><BounceBars count={7} className="big" /><span className="yt-muted">{t('board.elsewhere')}</span></div>}
          {stageKind === 'empty' && <div className="yt-empty" aria-label={t('player.empty')}>▶</div>}
          {stage && it?.kind === 'yt' && <YoutubeFrame key={`${it.videoId}:${s.index}:${retry}`} videoId={it.videoId} />}
          {stage && it?.kind === 'local' && <LocalTrack key={`${it.path}:${s.index}`} path={it.path} title={it.title} />}
        </div>
      )}
    >
      {s.error && (
        <div className="yt-error">
          {t(`code.${s.error}`)}
          {s.error === SIGN_IN_WALL && it?.kind === 'yt' && (
            <>
              {' '}<button className="link" onClick={() => openExternal(SIGN_IN_URL)}>{t('player.signIn')}</button>
              {' '}<button className="link" onClick={() => { setRetry((n) => n + 1); player.retry(); }}>{t('player.retry')}</button>
              {' '}<button className="link" onClick={() => openExternal(watchUrl(it.videoId))}>{t('player.openOnYoutube')} ↗</button>
            </>
          )}
        </div>
      )}
      <div className="yt-controls">
        <button className="icon-btn" title={t('player.previous')} aria-label={t('player.previous')} disabled={!it} onClick={() => player.previous()}>⏮</button>
        <button className="icon-btn primary" title={playLabel} aria-label={playLabel} disabled={!it} onClick={() => player.toggle()}>{s.playing ? '❚❚' : '▶'}</button>
        <button className="icon-btn" title={t('player.next')} aria-label={t('player.next')} disabled={!it} onClick={() => player.next()}>⏭</button>
        <span className="yt-muted">{clock(s.position)} / {clock(s.duration)}</span>
        <button className="icon-btn" title={s.muted ? t('player.unmute') : t('player.mute')} aria-label={s.muted ? t('player.unmute') : t('player.mute')} aria-pressed={s.muted} onClick={() => player.setMuted(!s.muted)}>{s.muted ? '🔇' : '🔊'}</button>
        <input
          type="range" min={0} max={100} value={volume} aria-label={t('player.volume')}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); player.setVolume(v); }}
          onPointerUp={() => remember(volume)}
          onKeyUp={() => remember(volume)}
        />
      </div>
    </Section>
  );
}
