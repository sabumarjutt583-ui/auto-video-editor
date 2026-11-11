import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBySeconds } from './build.ts';
import { validTimingRanges } from './schedule.ts';
import { readProfile, defaultProfile } from '../pipeline/profile.ts';

test('custom ranges cut at word boundaries, cover every word once, and change cadence', () => {
  const words = Array.from({length: 30}, (_, i) => ({text: `word${i}`, start: i, end: i + .7}));
  const settings = {mode: 'seconds' as const, sentencesPerScene: 1, targetSeconds: 5, maxVideoSeconds: 8, minSeconds: 0, timingRanges: [{startSeconds: 0, targetSeconds: 3}, {startSeconds: 6, targetSeconds: 8}]};
  const scenes = buildBySeconds({words, voiceDuration: 30, settings});
  assert.deepEqual(scenes.map(s => s.start), [0,3,6,14,22]);
  assert.equal(scenes.at(-1)?.end, 30);
  assert.equal(scenes.reduce((n,s) => n+s.lastWord-s.firstWord+1, 0), words.length);
  scenes.forEach((s,i) => { if(i) assert.equal(s.start, scenes[i-1].end); });
  assert.deepEqual(buildBySeconds({words: [], voiceDuration: 0, settings}), []);
});

test('invalid schedules are rejected instead of silently sorting or accepting gaps', () => {
  for (const value of [[{startSeconds: 1,targetSeconds: 3}], [{startSeconds:0,targetSeconds:0}], [{startSeconds:0,targetSeconds:3},{startSeconds:0,targetSeconds:5}]]) assert.deepEqual(validTimingRanges(value), []);
});

 test('channel profile round trip preserves custom scene timing ranges', () => {
 const profile = defaultProfile('channel');
 profile.scenes.timingRanges = [{startSeconds:0,targetSeconds:3},{startSeconds:60,targetSeconds:8}];
 assert.deepEqual(readProfile(JSON.parse(JSON.stringify(profile))).scenes.timingRanges, profile.scenes.timingRanges);
});


test('fixed presets split a sentence without punctuation and preserve every word', () => {
  const words = Array.from({length: 60}, (_, i) => ({text: `w${i}`, start: i * .3, end: i * .3 + .2}));
  for (const targetSeconds of [3,5,8]) {
    const scenes = buildBySeconds({words, voiceDuration:18, settings:{mode:'seconds',sentencesPerScene:1,targetSeconds,maxVideoSeconds:8,minSeconds:0}});
    assert.ok(scenes.length >= 2);
    assert.equal(scenes.map(s=>s.text).join(' '), words.map(w=>w.text).join(' '));
    assert.equal(scenes.at(-1)?.end,18);
    scenes.forEach((s,i)=>{ if(i) assert.equal(s.start,scenes[i-1].end); assert.ok(s.duration <= targetSeconds + .31); });
  }
});

test('selected cadence preserves a short tail even when minimum scene duration is set', () => {
 const words=Array.from({length:35},(_,i)=>({text:`w${i}`,start:i*.5,end:i*.5+.3}));
 const scenes=buildBySeconds({words,voiceDuration:17.4,settings:{mode:'seconds',sentencesPerScene:1,targetSeconds:8,maxVideoSeconds:8,minSeconds:3}});
 assert.equal(scenes.length,3);
 assert.deepEqual(scenes.map(s=>s.start),[0,8,16]);
 assert.ok(Math.abs(scenes.at(-1)!.duration - 1.4) < 1e-9);
 assert.equal(scenes.reduce((n,s)=>n+s.lastWord-s.firstWord+1,0),35);
});
