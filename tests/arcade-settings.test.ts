import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defineSetting, isGameSetting, onSettingChange, setSetting, trackSettingChange, type SettingChange } from '../src/os/arcade/kit/settings.ts';

test('setting changes report the old and new value, and only real changes', () => {
  const level = defineSetting('demo:level', ['easy', 'hard'] as const, 'easy');
  const scenery = defineSetting('demo-scenery', ['day', 'night'] as const, 'day', { live: true });
  const seen: SettingChange[] = [];
  const off = onSettingChange((change) => seen.push(change));
  setSetting(level, 'hard');
  setSetting(level, 'hard');
  setSetting(scenery, 'night');
  off();
  setSetting(level, 'easy');
  assert.deepEqual(seen, [
    { key: 'demo:level', from: 'easy', to: 'hard', live: false },
    { key: 'demo-scenery', from: 'day', to: 'night', live: true },
  ]);
});

test('a pause only needs a new game while a setting differs from where it started', () => {
  const changed = new Map<string, string>();
  assert.equal(trackSettingChange(changed, { key: 'coxbox:rivals', from: 'novice', to: 'olympic', live: false }), true);
  assert.equal(trackSettingChange(changed, { key: 'coxbox:rivals', from: 'olympic', to: 'club', live: false }), true);
  assert.equal(trackSettingChange(changed, { key: 'coxbox:rivals', from: 'club', to: 'novice', live: false }), false, 'back where it started');
  assert.equal(trackSettingChange(changed, { key: 'chicken-crossing-scenery', from: 'meadow', to: 'sunset', live: true }), false, 'cosmetic settings keep Resume');
});

test('settings belong to the game whose id starts their key', () => {
  assert.ok(isGameSetting('coxbox:rivals', 'coxbox'));
  assert.ok(isGameSetting('chicken-crossing-scenery', 'chicken-crossing'));
  assert.ok(!isGameSetting('pong:mode', 'coxbox'));
  assert.ok(!isGameSetting('chess:level', 'checkers'));
});
