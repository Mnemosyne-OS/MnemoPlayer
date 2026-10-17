/**
 * ChannelTab — the person's own channel (doc 151 §5): statistics, latest
 * videos, latest comments, and a reply under each comment.
 *
 * 🚨 A reply leaves only from the « Envoyer » click here (the host refuses
 * `youtube.reply` without a click in this window). A voice can only put a
 * draft in the box: the person reads it, changes it if they want, and sends.
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { getAccount, load, newSince, useAccount, type Thread } from '../lib/account';
import { call, codeOf } from '../lib/host';
import { getLibrarySnapshot, updateLibrary } from '../lib/libraryStore';
import * as player from '../lib/player';
import { patchScreen, setReplyDraft, showTab, useScreen } from '../lib/screen';
import { ItemRow } from './ItemRow';
import { Section } from './Section';

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

function CommentCard({ c, video, isNew, draft, focus, canReply }: { c: Thread; video: string; isNew: boolean; draft: string; focus: boolean; canReply: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ sending: boolean; error: string | null; sent: boolean }>({ sending: false, error: null, sent: false });
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focus]);

  const send = async () => {
    setState({ sending: true, error: null, sent: false });
    try {
      await call('youtube.reply', { threadId: c.id, text: draft });
      setReplyDraft(c.id, '');
      setState({ sending: false, error: null, sent: true });
      void load('comments');
    } catch (err) {
      setState({ sending: false, error: codeOf(err), sent: false });
    }
  };

  return (
    <div ref={ref} className={`yt-comment glass${focus ? ' focus' : ''}`}>
      <div className="yt-row">
        <b>{c.author}</b>
        {isNew && <span className="yt-badge new">{t('channel.new')}</span>}
        <span className="yt-muted">{video}</span>
      </div>
      <p>{c.text}</p>
      {c.replies.length > 0 && (
        <div className="yt-replies">
          {c.replies.map((r) => <div key={r.id}><b>{r.author}</b> {r.text}</div>)}
        </div>
      )}
      {c.canReply && canReply && (
        <>
          <textarea value={draft} placeholder={t('channel.replyPlaceholder')} aria-label={t('channel.replyTo', { author: c.author })} onChange={(e) => setReplyDraft(c.id, e.target.value)} />
          <div className="yt-row">
            <button className="primary" disabled={!draft.trim() || state.sending} onClick={() => void send()}>{state.sending ? t('common.sending') : t('channel.send')}</button>
            {state.sent && <span className="yt-ok">{t('channel.sent')}</span>}
            {state.error && <span className="yt-error">{t(`code.${state.error}`)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function ChannelTab() {
  const { t } = useI18n();
  const acc = useAccount();
  const screen = useScreen();
  const now = player.usePlayer();
  // What was new when the tab opened stays marked while it is open.
  const [seenBefore] = useState(() => getLibrarySnapshot().library.commentsSeenAt);

  const connected = !!acc.account?.canRead;
  useEffect(() => {
    if (!connected) return;
    const a = getAccount();
    if (!a.channel) void load('channel');
    if (!a.videos) void load('videos');
    if (!a.comments) void load('comments');
  }, [connected]);

  useEffect(() => {
    // Looked at = seen: the next « combien de nouveaux commentaires » counts from now.
    if (!acc.comments) return;
    const at = new Date().toISOString();
    updateLibrary((lib) => ({ ok: true, library: { ...lib, commentsSeenAt: at } }))
      .then((r) => { if (!r.ok && r.code !== 'NOT_READY') console.warn('[youtube] comments not marked seen:', r.code); })
      .catch((err: unknown) => console.warn('[youtube] comments not marked seen:', err));
  }, [acc.comments]);

  useEffect(() => () => patchScreen({ focusThread: null }), []);

  if (!acc.account) {
    return acc.errors.account
      ? <div className="yt-panel glass full yt-error">{t(`code.${acc.errors.account}`)}</div>
      : <div className="yt-panel glass full yt-muted">{t('common.loading')}</div>;
  }
  if (!connected) {
    return (
      <div className="yt-panel glass full">
        <div className="yt-note">{t(acc.account.connected ? 'code.SCOPE_MISSING' : 'channel.connectFirst')}</div>
        <div><button className="primary" onClick={() => showTab('settings')}>{t('tabs.settings')}</button></div>
      </div>
    );
  }

  const ch = acc.channel;
  const fresh = new Set(newSince(acc.comments ?? [], seenBefore).map((c) => c.id));
  const title = (id: string) => acc.videos?.find((v) => v.id === id)?.title ?? '';
  const current = player.current(now);
  const videoItems = (acc.videos ?? []).map((v) => ({ kind: 'yt' as const, videoId: v.id, title: v.title }));

  return (
    <>
      <Section
        id="channel"
        title={<>{ch?.thumbnail && <img src={ch.thumbnail} alt="" width={28} height={28} className="yt-avatar" />}{ch?.title ?? t('channel.title')}</>}
        actions={<button className="icon-btn" title={t('channel.reload')} aria-label={t('channel.reload')} onClick={() => { void load('channel'); void load('videos'); void load('comments'); }}>↻</button>}
      >
        {acc.errors.channel && <div className="yt-error">{t(`code.${acc.errors.channel}`)}</div>}
        <div className="yt-stats">
          <div className="yt-stat glass"><b>{fmt(ch?.subscribers ?? null)}</b><span className="yt-muted">{t('channel.subscribers')}</span></div>
          <div className="yt-stat glass"><b>{fmt(ch?.views ?? null)}</b><span className="yt-muted">{t('channel.views')}</span></div>
          <div className="yt-stat glass"><b>{fmt(ch?.videos ?? null)}</b><span className="yt-muted">{t('channel.videos')}</span></div>
        </div>
        <h2>{t('channel.latest')}</h2>
        {acc.loading.videos && <div className="yt-muted">{t('common.loading')}</div>}
        {acc.errors.videos && <div className="yt-error">{t(`code.${acc.errors.videos}`)}</div>}
        {acc.videos && !acc.videos.length && <div className="yt-muted">{t('channel.noVideos')}</div>}
        <div className="yt-list">
          {(acc.videos ?? []).map((v, i) => (
            <ItemRow
              key={v.id}
              item={videoItems[i]!}
              thumbnail={v.thumbnail}
              sub={[v.privacy ? t(`privacy.${v.privacy}`) : null, `${fmt(v.views)} ${t('channel.viewsShort')}`, `${fmt(v.likes)} ♥`, `${fmt(v.comments)} 💬`].filter(Boolean).join(' · ')}
              playing={current?.kind === 'yt' && current.videoId === v.id}
              onPlay={() => player.playQueue(videoItems, i, { kind: 'channel' })}
            />
          ))}
        </div>
      </Section>
      <Section id="comments" title={<>{t('channel.comments')} {fresh.size > 0 && <span className="yt-badge new">{t('channel.newCount', { count: fresh.size })}</span>}</>}>
        {acc.loading.comments && <div className="yt-muted">{t('common.loading')}</div>}
        {acc.errors.comments && <div className="yt-error">{t(`code.${acc.errors.comments}`)}</div>}
        {acc.comments && !acc.comments.length && <div className="yt-muted">{t('channel.noComments')}</div>}
        {(acc.comments ?? []).map((c) => (
          <CommentCard
            key={c.id} c={c} video={title(c.videoId)} isNew={fresh.has(c.id)}
            draft={screen.replyDrafts[c.id] ?? ''} focus={screen.focusThread === c.id}
            canReply={!!acc.account?.canReply}
          />
        ))}
      </Section>
    </>
  );
}
