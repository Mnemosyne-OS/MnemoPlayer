/**
 * SoundPanel — the visualizer and the equalizer (doc 151 §10-§12), the UI only.
 *
 * The audio graph lives in SoundGraphHost, mounted in the window that plays:
 * this panel can be folded, closed (its 🎚 icon in the tab bar brings it back)
 * or shown in its own window of the exploded view without ever silencing a
 * song. In that window the bands come from the player window (peerSound.ts).
 */
import { useI18n } from '../i18n/useI18n';
import { EQ_BANDS, EQ_MAX_DB, EQ_PRESETS } from '../lib/eq';
import { startOutput, stopOutput, useOutput } from '../lib/outputSpectrum';
import * as player from '../lib/player';
import { setBand, setLook, setPreset, setVizOn, useSoundPrefs, VIZ_LOOKS, type VizLook } from '../lib/soundPrefs';
import { BounceBars } from './BounceBars';
import { Section } from './Section';
import { Visualizer } from './Visualizer';
import '../sound.css';

const LOOK_ICONS: Record<VizLook, string> = { bounce: '▂▆▃▇', bars: '▮▮▮', radial: '◎', wave: '∿' };
const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

export function SoundPanel({ closable = true }: { closable?: boolean }) {
  const { t } = useI18n();
  const prefs = useSoundPrefs();
  const out = useOutput();
  const s = player.usePlayer();
  const kind = player.current(s)?.kind ?? null;

  const outputOn = out.status === 'on' || out.status === 'starting';
  const offerOutput = out.status !== 'unsupported' && out.status !== 'unknown';
  // The canvas looks show an ambience on YouTube and say why; the bouncing bars are a playing sign there on their own.
  const ambient = s.playing && kind === 'yt' && out.status !== 'on' && prefs.look !== 'bounce';

  return (
    <Section id="sound" title={t('sound.title')} className="yt-sound" {...(closable ? { closable: 'sound' as const } : {})}>
      <div className="yt-row yt-sound-bar">
        <div className="segmented glass" role="group" aria-label={t('sound.viz')}>
          {VIZ_LOOKS.map((look) => {
            const on = prefs.vizOn && prefs.look === look;
            return (
              <button key={look} className={`icon-btn${on ? ' on' : ''}`} aria-pressed={on} title={t(`sound.look.${look}`)} aria-label={t(`sound.look.${look}`)} onClick={() => setLook(look)}>
                {LOOK_ICONS[look]}
              </button>
            );
          })}
        </div>
        <button className="icon-btn" aria-pressed={!prefs.vizOn} title={prefs.vizOn ? t('sound.vizOff') : t('sound.vizOn')} aria-label={prefs.vizOn ? t('sound.vizOff') : t('sound.vizOn')} onClick={() => setVizOn(!prefs.vizOn)}>
          {prefs.vizOn ? '◐' : '○'}
        </button>
        <span style={{ flex: 1 }} />
        {ambient && <span className="yt-badge" role="note" title={t('sound.ambient')} aria-label={t('sound.ambient')}>✦</span>}
        {offerOutput && (
          <button
            className={`icon-btn${outputOn ? ' yt-on' : ''}`}
            aria-pressed={outputOn}
            disabled={out.status === 'starting'}
            title={outputOn ? t('sound.outputStop') : t('sound.output')}
            aria-label={outputOn ? t('sound.outputStop') : t('sound.output')}
            onClick={() => void (outputOn ? stopOutput() : startOutput())}
          >
            🖥
          </button>
        )}
      </div>
      {prefs.vizOn && (prefs.look === 'bounce'
        ? <div className="yt-viz yt-viz-bounce"><BounceBars count={24} className="big" /></div>
        : <Visualizer look={prefs.look} label={t('sound.viz')} />)}
      {out.status === 'on' && <div className="yt-muted">{t('sound.outputOn')}</div>}
      {out.error && <div className="yt-error">{t(`code.${out.error}`)}</div>}

      <Section
        id="eq"
        className="yt-eq"
        title={t('sound.eq')}
        actions={kind === 'yt' ? <span className="yt-muted">{t('sound.eqLocalOnly')}</span> : null}
      >
        <div className="yt-chips">
          {EQ_PRESETS.map((p) => (
            <button key={p} className={`chip-tile glass${prefs.preset === p ? ' chosen' : ''}`} aria-pressed={prefs.preset === p} onClick={() => setPreset(p)}>
              {t(`sound.preset.${p}`)}
            </button>
          ))}
          {prefs.preset === 'custom' && <span className="chip-tile glass chosen" aria-current="true">{t('sound.preset.custom')}</span>}
        </div>
        <div className="yt-eq-bands" role="group" aria-label={t('sound.eq')}>
          {EQ_BANDS.map((hz, i) => (
            <label key={hz} className="yt-eq-band">
              <input
                type="range" min={-EQ_MAX_DB} max={EQ_MAX_DB} step={0.5}
                value={prefs.gains[i] ?? 0}
                aria-label={t('sound.band', { hz: hzLabel(hz) })}
                aria-valuetext={`${prefs.gains[i] ?? 0} dB`}
                onChange={(e) => setBand(i, Number(e.target.value))}
                onDoubleClick={() => setBand(i, 0)}
              />
              <span>{hzLabel(hz)}</span>
            </label>
          ))}
        </div>
      </Section>
    </Section>
  );
}
