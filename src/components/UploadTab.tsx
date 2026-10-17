/**
 * UploadTab — one video from the person's computer to their channel
 * (doc 151 §6). The file is picked in the system dialog and read by the host;
 * this window gets a name and a size, never the path.
 *
 * 🚨 Sent only by the « Mettre en ligne » click (the host refuses the door
 * without a click here). A voice can fill the title and the description, never
 * press send. Every upload goes PRIVATE and the line above the button says so
 * BEFORE anything leaves: until Google reviews the app, YouTube keeps every
 * upload made this way private, and answers « success » anyway.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { call, codeOf, openExternal } from '../lib/host';
import { useAccount } from '../lib/account';
import { patchUpload, showTab, useScreen } from '../lib/screen';
import { Section } from './Section';

interface UploadStatus {
  jobId: string;
  name: string;
  state: 'starting' | 'uploading' | 'done' | 'failed' | 'cancelled';
  confirmed: number;
  total: number;
  videoId?: string;
  privacy?: string;
  error?: string;
}

const POLL_MS = 1500;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} Mo`;

export function UploadTab() {
  const { t } = useI18n();
  const acc = useAccount();
  const draft = useScreen().upload;
  const [job, setJob] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const running = job?.state === 'starting' || job?.state === 'uploading';
  const jobId = job?.jobId ?? null;
  useEffect(() => {
    if (!jobId || !running) return undefined;
    const timer = window.setInterval(() => {
      call<UploadStatus>('youtube.uploadStatus', { jobId })
        .then(setJob)
        .catch((err: unknown) => setError(codeOf(err)));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [jobId, running]);

  if (!acc.account) {
    return acc.errors.account
      ? <div className="yt-panel glass full yt-error">{t(`code.${acc.errors.account}`)}</div>
      : <div className="yt-panel glass full yt-muted">{t('common.loading')}</div>;
  }
  if (!acc.account.canUpload) {
    return (
      <div className="yt-panel glass full">
        <div className="yt-note">{t(acc.account.connected ? 'code.SCOPE_MISSING' : 'channel.connectFirst')}</div>
        <div><button className="primary" onClick={() => showTab('settings')}>{t('tabs.settings')}</button></div>
      </div>
    );
  }

  const pick = async () => {
    setError(null);
    try {
      // No deadline: the system dialog stays open as long as the person is choosing.
      const file = await call<{ id: string; name: string; size: number }>('youtube.pickVideo', undefined, 0);
      patchUpload({ file });
    } catch (err) {
      const code = codeOf(err);
      if (code !== 'CANCELED') setError(code);
    }
  };

  const send = async () => {
    if (!draft.file || draft.madeForKids === null) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await call<{ jobId: string }>('youtube.upload', {
        fileId: draft.file.id, title: draft.title, description: draft.description, madeForKids: draft.madeForKids,
      });
      setJob({ jobId, name: draft.file.name, state: 'starting', confirmed: 0, total: draft.file.size });
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!job) return;
    call('youtube.uploadCancel', { jobId: job.jobId }).catch((err: unknown) => setError(codeOf(err)));
  };

  const pct = job && job.total > 0 ? Math.floor((job.confirmed / job.total) * 100) : 0;
  const ready = !!draft.file && !!draft.title.trim() && draft.madeForKids !== null && !running && !busy;

  return (
    <Section id="upload" className="full" title={t('upload.title')}>
      <div className="yt-row">
        <button onClick={() => void pick()} disabled={running}>{draft.file ? t('upload.changeFile') : t('upload.pickFile')}</button>
        {draft.file && <span>{draft.file.name} · {mb(draft.file.size)}</span>}
      </div>
      <label className="yt-field">{t('upload.videoTitle')}
        <input type="text" maxLength={100} value={draft.title} onChange={(e) => patchUpload({ title: e.target.value })} />
      </label>
      <label className="yt-field">{t('upload.description')}
        <textarea maxLength={5000} value={draft.description} onChange={(e) => patchUpload({ description: e.target.value })} />
      </label>
      <div className="yt-row" role="radiogroup" aria-label={t('upload.kids')}>
        <span className="yt-muted">{t('upload.kids')}</span>
        <button className={`chip-tile glass${draft.madeForKids === false ? ' chosen' : ''}`} aria-pressed={draft.madeForKids === false} onClick={() => patchUpload({ madeForKids: false })}>{t('upload.kidsNo')}</button>
        <button className={`chip-tile glass${draft.madeForKids === true ? ' chosen' : ''}`} aria-pressed={draft.madeForKids === true} onClick={() => patchUpload({ madeForKids: true })}>{t('upload.kidsYes')}</button>
      </div>
      <div className="yt-note">{t('upload.privateUntilReview')}</div>
      <div className="yt-row">
        <button className="primary" disabled={!ready} onClick={() => void send()}>{t('upload.send')}</button>
        {running && <button onClick={cancel}>{t('upload.stop')}</button>}
      </div>
      {job && (
        <div className="yt-list">
          <div className="yt-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
          <div className="yt-muted">{t(`upload.state.${job.state}`)} · {mb(job.confirmed)} / {mb(job.total)} ({pct} %)</div>
          {job.state === 'done' && job.videoId && (
            <div className="yt-row">
              <span className="yt-ok">{t('upload.done', { privacy: job.privacy ? t(`privacy.${job.privacy}`) : '—' })}</span>
              <button className="link" onClick={() => openExternal(`https://studio.youtube.com/video/${job.videoId}/edit`)}>{t('upload.openStudio')} ↗</button>
            </div>
          )}
          {job.state === 'failed' && job.error && <div className="yt-error">{t(`code.${job.error}`)}</div>}
        </div>
      )}
      {error && <div className="yt-error">{t(`code.${error}`)}</div>}
    </Section>
  );
}
