/**
 * MnemoPlayer's agent actions (doc 149, doc 151 §7): the manifest passes the
 * HOST's own check, every declared action has its handler, and the outward
 * actions (a reply, an upload) can only be PREPARED by a voice — there is no
 * action that sends.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentActionsFromManifest, agentGuideFromManifest } from '../../../infinity-edition/src/main/plugins/cartridgeAgentActions';
import { youtubeAgentHandlers } from './agent';

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'mnemo-plugin.json'), 'utf8')) as Record<string, unknown>;
const source = readFileSync(join(root, 'src', 'lib', 'agent.ts'), 'utf8');
const block = source.slice(source.indexOf('// agent-actions:begin'), source.indexOf('// agent-actions:end'));
const handlers = [...block.matchAll(/^ {4}(\w+): (?:async )?\(/gm)].map((m) => m[1]);

function declared() {
  const r = agentActionsFromManifest(manifest);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe("MnemoPlayer's agent actions", () => {
  it("pass the host's check of the manifest, guide included", () => {
    const r = agentActionsFromManifest(manifest);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    expect(agentGuideFromManifest(manifest)).not.toBeNull();
  });

  it('every declared action has its handler, and no handler is undeclared', () => {
    expect(handlers.length).toBeGreaterThan(10);
    expect([...handlers].sort()).toEqual(declared().map((a) => a.id).sort());
    expect(Object.keys(youtubeAgentHandlers({ newId: () => 'x', now: () => new Date() })).sort()).toEqual([...handlers].sort());
  });

  it('nothing spends, and nothing SENDS: a reply and an upload are only drafted', () => {
    const ids = declared().map((a) => a.id);
    expect(declared().filter((a) => a.effect === 'spend')).toEqual([]);
    for (const banned of ['sendReply', 'reply', 'upload', 'uploadVideo', 'publish', 'deletePlaylist', 'removePlaylist', 'setKey', 'connect']) {
      expect(ids).not.toContain(banned);
    }
    expect(ids).toEqual(expect.arrayContaining(['draftReply', 'draftUpload']));
    expect(declared().filter((a) => a.effect === 'read').map((a) => a.id).sort()).toEqual(['channelStats', 'comments', 'nowPlaying']);
  });

  it('voice: example sentences in fr, en and es, and a guide that says to name things as the person does', () => {
    const m = manifest as { voiceCommands?: Record<string, string[]>; agentGuide?: string[] };
    for (const lang of ['fr', 'en', 'es']) expect(m.voiceCommands?.[lang]?.length).toBeGreaterThanOrEqual(5);
    expect(m.agentGuide?.[0]).toMatch(/AMBIGUOUS/);
    expect(m.agentGuide?.join(' ')).toMatch(/never say a reply was sent/);
  });

  it('the tabs it can show are the window’s own', async () => {
    const { TABS } = await import('./screen');
    const p = declared().find((a) => a.id === 'showTab')!.params.tab;
    expect(p?.type === 'string' ? p.enum : null).toEqual([...TABS]);
  });

  it('the looks a voice can name are the window’s own, bouncing bars first', async () => {
    const { VIZ_LOOKS } = await import('./soundPrefs');
    const p = declared().find((a) => a.id === 'setVisualizer')!.params.look;
    expect(p?.type === 'string' ? p.enum : null).toEqual([...VIZ_LOOKS]);
    expect(VIZ_LOOKS[0]).toBe('bounce');
  });
});
