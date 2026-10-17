/**
 * soundAgent.ts — the voice's hands on the equalizer and the visualizer
 * (doc 151 §10.4). Declared in `mnemo-plugin.json` › agentActions and wired
 * in agent.ts' handler block; each one calls the SAME store function as the
 * panel's tiles and icons, so the person sees it change.
 *
 * ⛔ No action turns on the output spectrum: it listens to the whole
 * computer's sound and the host only lets it start from a click in the window.
 */
import { translate as t } from '../i18n/useI18n';
import { EQ_PRESETS, isPreset } from './eq';
import * as player from './player';
import { getSoundPrefs, isLook, nextLook, setLook, setPreset, setVizOn, VIZ_LOOKS } from './soundPrefs';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function setEqualizerAction(args: Record<string, unknown>) {
  const preset = str(args.preset);
  if (!isPreset(preset)) throw new Error(`NO_PRESET: the presets are ${EQ_PRESETS.join(', ')}`);
  setPreset(preset);
  const name = t(`sound.preset.${preset}`);
  const onYoutube = player.current()?.kind === 'yt';
  return {
    preset,
    appliesTo: 'music folder',
    // Said, because a jazz curve that changes nothing on the YouTube video playing reads as broken.
    say: onYoutube ? t('say.eqYoutube', { name }) : t('say.eqPreset', { name }),
  };
}

export function setVisualizerAction(args: Record<string, unknown>) {
  const change = str(args.change);
  const look = str(args.look);
  if (change === 'off') {
    setVizOn(false);
    return { on: false, say: t('say.vizOff') };
  }
  let next = getSoundPrefs().look;
  if (look) {
    if (!isLook(look)) throw new Error(`NO_LOOK: the looks are ${VIZ_LOOKS.join(', ')}`);
    next = look;
  } else if (change === 'next') next = nextLook();
  else if (change !== 'on') throw new Error('BAD_ARG: give look (bounce, bars, radial, wave) or change (next, on, off)');
  setLook(next);
  return { on: true, look: next, say: t('say.vizLook', { name: t(`sound.look.${next}`) }) };
}
