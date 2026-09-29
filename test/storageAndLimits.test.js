import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { openGuildSettings } from '../src/storage/guildSettings.js';
import { createRateLimiter, describeWait } from '../src/utils/rateLimiter.js';

test('guild settings add, list, remove, and forget channels', () => {
  const settings = openGuildSettings({ memory: true });

  assert.equal(settings.addChannel('g1', 'c1', 'u1'), true);
  assert.equal(settings.addChannel('g1', 'c1', 'u1'), false); // already watched
  settings.addChannel('g1', 'c2');
  settings.addChannel('g2', 'c3');

  assert.deepEqual(settings.listChannels('g1'), ['c1', 'c2']);
  assert.ok(settings.isWatched('c1'));

  assert.equal(settings.removeChannel('g1', 'c1'), true);
  assert.equal(settings.removeChannel('g1', 'c1'), false);
  assert.ok(!settings.isWatched('c1'));

  settings.forgetGuild('g1');
  assert.deepEqual(settings.listChannels('g1'), []);
  assert.ok(!settings.isWatched('c2'));
  assert.ok(settings.isWatched('c3'));
  settings.close();
});

test('guild settings persist across restarts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hhbot-'));
  try {
    const first = openGuildSettings({ dataDir: dir });
    first.addChannel('g1', 'c1');
    first.close();

    const second = openGuildSettings({ dataDir: dir });
    assert.ok(second.isWatched('c1'));
    assert.deepEqual(second.listChannels('g1'), ['c1']);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rate limiter enforces per-user hourly and per-guild daily limits', () => {
  let t = 0;
  const limiter = createRateLimiter({ perUserPerHour: 2, perGuildPerDay: 3, now: () => t });

  assert.ok(limiter.take('u1', 'g1').ok);
  assert.ok(limiter.take('u1', 'g1').ok);
  const blocked = limiter.take('u1', 'g1');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.scope, 'user');
  assert.equal(blocked.retryAfterMs, 60 * 60 * 1000);

  assert.ok(limiter.take('u2', 'g1').ok); // 3rd hand in the guild
  const guildBlocked = limiter.take('u3', 'g1');
  assert.equal(guildBlocked.scope, 'guild');

  t += 60 * 60 * 1000 + 1; // an hour later the user window has passed...
  assert.equal(limiter.take('u1', 'g1').scope, 'guild'); // ...but the guild's day hasn't
  assert.ok(limiter.take('u1', 'g2').ok);
});

test('a limit of 0 disables it', () => {
  const limiter = createRateLimiter({ perUserPerHour: 0, perGuildPerDay: 0 });
  for (let i = 0; i < 50; i++) assert.ok(limiter.take('u1', 'g1').ok);
});

test('describes waits in minutes or hours', () => {
  assert.equal(describeWait(30_000), '1 minute');
  assert.equal(describeWait(90_000), '2 minutes');
  assert.equal(describeWait(2 * 60 * 60 * 1000), '2 hours');
});
