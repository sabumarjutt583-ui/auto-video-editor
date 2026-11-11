import assert from 'node:assert/strict';
import test from 'node:test';
import { localeLabel, microsoftVoiceLabel } from './voiceLabels.ts';

test('language labels include readable language and country without technical codes', () => {
  assert.equal(localeLabel('ur-PK'), 'Urdu (Pakistan)');
  assert.equal(localeLabel('en-US'), 'English (United States)');
  assert.equal(localeLabel('ar-BH'), 'Arabic (Bahrain)');
  assert.equal(localeLabel('not_a_locale'), 'not_a_locale');
  assert.equal(microsoftVoiceLabel('ur-PK-AsadNeural', 'ur-PK', 'Male'), 'Asad');
  assert.equal(microsoftVoiceLabel('en-US-AndrewMultilingualNeural'), 'Andrew (Multilingual)');
  assert.equal(microsoftVoiceLabel('ko-KR-SunHiNeural'), 'SunHi');
});

test('favourites remain separate by provider, persist and toggle off', async () => {
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string,v: string) => saved.set(k,v), removeItem: (k: string) => saved.delete(k)} });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: globalThis.localStorage } });
  const {useVoiceFavoritesStore: store} = await import('../../store/voiceFavoritesStore.ts');
  store.getState().toggle('edge', 'ur-PK-AsadNeural');
  store.getState().toggle('gemini', 'Kore');
  assert.deepEqual(store.getState().edge, ['ur-PK-AsadNeural']);
  assert.deepEqual(store.getState().gemini, ['Kore']);
  await store.persist.rehydrate();
  assert.deepEqual(store.getState().gemini, ['Kore']);
  store.getState().toggle('edge', 'ur-PK-AsadNeural');
  assert.deepEqual(store.getState().edge, []);
  assert.deepEqual(JSON.parse(saved.get('auto-video-editor-voice-favorites')!).state.gemini, ['Kore']);
});
