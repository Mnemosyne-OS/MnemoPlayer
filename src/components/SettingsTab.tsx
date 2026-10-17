/**
 * SettingsTab — the person's own Google keys, typed once (doc 151 §4-§5).
 *
 * The key and the client secret go straight to the host, which seals them;
 * this window never reads them back (it only knows THAT they are set, and
 * when). The fields empty themselves after a save.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { refreshConnection, useAccount } from '../lib/account';
import { call, codeOf, openExternal } from '../lib/host';
import { Section } from './Section';

const CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';

export function SettingsTab() {
  const { t } = useI18n();
  const acc = useAccount();
  const [key, setKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { void refreshConnection(); }, []);

  const run = async (what: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(what);
    setSaid(null);
    try {
      const res = await fn();
      const warning = res && typeof res === 'object' && 'warning' in res ? (res as { warning?: string }).warning : undefined;
      setSaid({ ok: true, text: warning ? `${okText} · ${t(`code.${warning}`)}` : okText });
    } catch (err) {
      setSaid({ ok: false, text: t(`code.${codeOf(err)}`) });
    } finally {
      setBusy(null);
      void refreshConnection();
    }
  };

  const k = acc.key;
  const a = acc.account;
  const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—');

  return (
    <Section
      id="settings"
      className="full"
      title={t('settings.title')}
      actions={<button className="link" onClick={() => openExternal(CREDENTIALS_URL)}>{t('settings.googleCloud')} ↗</button>}
    >
      <ol className="yt-steps">
        <li>
          <span className={`n${k?.present ? ' done' : ''}`}>1</span>
          <div className="body">
            <b>{t('settings.key')}</b>
            {k?.present && <span className="yt-muted">{t('settings.keySaved', { date: date(k.savedAt) })}</span>}
            <div className="yt-row">
              <input type="password" autoComplete="off" value={key} placeholder={t('settings.keyPlaceholder')} aria-label={t('settings.key')} onChange={(e) => setKey(e.target.value)} />
              <button className="primary" disabled={!key.trim() || busy !== null} onClick={() => void run('key', async () => { const r = await call('youtube.setKey', { key }); setKey(''); return r; }, t('settings.saved'))}>{t('common.save')}</button>
              {k?.present && <button disabled={busy !== null} onClick={() => void run('rmkey', () => call('youtube.removeKey'), t('settings.removed'))}>{t('settings.forget')}</button>}
            </div>
          </div>
        </li>
        <li>
          <span className={`n${a?.hasClient ? ' done' : ''}`}>2</span>
          <div className="body">
            <b>{t('settings.client')}</b>
            {a?.hasClient && <span className="yt-muted">{t('settings.clientSaved')}</span>}
            <div className="yt-row">
              <input type="text" autoComplete="off" value={clientId} placeholder={t('settings.clientId')} aria-label={t('settings.clientId')} onChange={(e) => setClientId(e.target.value)} />
              <input type="password" autoComplete="off" value={secret} placeholder={t('settings.clientSecret')} aria-label={t('settings.clientSecret')} onChange={(e) => setSecret(e.target.value)} />
              <button className="primary" disabled={!clientId.trim() || !secret.trim() || busy !== null} onClick={() => void run('client', async () => { const r = await call('youtube.setClient', { id: clientId, secret }); setClientId(''); setSecret(''); return r; }, t('settings.saved'))}>{t('common.save')}</button>
            </div>
          </div>
        </li>
        <li>
          <span className={`n${a?.canRead ? ' done' : ''}`}>3</span>
          <div className="body">
            <b>{t('settings.connect')}</b>
            {a?.connected && !a.canRead && <span className="yt-error">{t('code.SCOPE_MISSING')}</span>}
            {a?.canRead && <span className="yt-ok">{t('settings.connected')}</span>}
            <div className="yt-row">
              <button className="primary" disabled={!a?.hasClient || busy !== null} onClick={() => void run('connect', () => call('youtube.connect', undefined, 6 * 60_000), t('settings.connected'))}>
                {busy === 'connect' ? t('settings.waitingBrowser') : a?.canRead ? t('settings.reconnect') : t('settings.connect')}
              </button>
              {a?.connected && <button disabled={busy !== null} onClick={() => void run('disconnect', () => call('youtube.disconnect', undefined, 35_000), t('settings.disconnected'))}>{t('settings.disconnect')}</button>}
            </div>
            <span className="yt-muted">{t('settings.testingNote')}</span>
          </div>
        </li>
      </ol>
      {said && <div className={said.ok ? 'yt-ok' : 'yt-error'}>{said.text}</div>}
      {(acc.errors.key || acc.errors.account) && <div className="yt-error">{t(`code.${acc.errors.key ?? acc.errors.account}`)}</div>}
    </Section>
  );
}
