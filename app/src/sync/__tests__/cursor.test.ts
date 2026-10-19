import { describe, expect, test } from 'vitest';
import { LocalStore } from '../../data/LocalStore';
import { MemoryStorage } from '../../data/storage';
import { createCursorStore } from '../cursor';

const deps = () => ({ newId: () => 'ob-1', now: () => '2026-10-19T12:00:00.000Z' });

describe('createCursorStore', () => {
  test('defaults_to_0', async () => {
    expect(await createCursorStore(new MemoryStorage()).get()).toBe(0);
  });

  test('persists_across_instances', async () => {
    const storage = new MemoryStorage();
    await createCursorStore(storage).set(1234);

    expect(await createCursorStore(storage).get()).toBe(1234);
    expect(storage.snapshot()['gt:v1:sync']).toBe('{"cursor":1234}');
  });

  test('corrupt_value_reads_as_0', async () => {
    for (const raw of ['{not json', 'null', '7', '{"cursor":"9"}', '{"cursor":-1}', '{"cursor":1.5}', '{}']) {
      const storage = new MemoryStorage();
      await storage.multiSet([['gt:v1:sync', raw]]);
      expect(await createCursorStore(storage).get(), raw).toBe(0);
    }
  });

  test('cursor_key_does_not_disturb_the_local_store', async () => {
    const storage = new MemoryStorage();
    await createCursorStore(storage).set(5);

    const state = await new LocalStore(storage, deps()).load();

    expect(state.days.size).toBe(0);
  });
});
