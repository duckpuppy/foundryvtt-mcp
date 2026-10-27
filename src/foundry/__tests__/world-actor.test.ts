/**
 * @fileoverview Tests for FoundryClient.createWorldActor, including module flags
 * (e.g. a DDB Importer character link set at creation).
 */

import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../client.js';

const FOLDER_ID = 'ffffffffffffffff';

type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

const buildClient = () => {
  const client = new FoundryClient({ baseUrl: 'http://localhost:30000', writeEnabled: true });
  const emit = vi.fn(((_event, payload, cb) => {
    const data = (payload as { operation?: { data?: Array<Record<string, unknown>> } }).operation
      ?.data;
    cb({ result: [{ _id: 'newactor00000000', ...(data?.[0] ?? {}) }] });
  }) as SocketEmitMock);
  (client as unknown as { socket: { connected: boolean; emit: SocketEmitMock } }).socket = {
    connected: true,
    emit,
  };
  return { client, emit };
};

const createdData = (emit: ReturnType<typeof vi.fn>) =>
  ((emit.mock.calls[0] as unknown[])[1] as { operation: { data: Array<Record<string, unknown>> } })
    .operation.data[0];

describe('FoundryClient.createWorldActor', () => {
  it('creates a bare actor with only name and type', async () => {
    const { client, emit } = buildClient();
    await client.createWorldActor('Augury', 'character');
    expect(createdData(emit)).toEqual({ name: 'Augury', type: 'character' });
  });

  it('passes module flags through, as DDB Importer reads them', async () => {
    const { client, emit } = buildClient();
    const flags = {
      ddbimporter: {
        dndbeyond: {
          url: 'https://www.dndbeyond.com/characters/18400136',
          characterId: '18400136',
        },
      },
    };
    await client.createWorldActor('Augury', 'character', undefined, FOLDER_ID, flags);
    expect(createdData(emit)).toEqual({
      name: 'Augury',
      type: 'character',
      folder: FOLDER_ID,
      flags,
    });
  });

  it('rejects flags that are not keyed by module', async () => {
    const { client, emit } = buildClient();
    await expect(
      client.createWorldActor('Augury', 'character', undefined, undefined, {
        url: 'https://www.dndbeyond.com/characters/1',
      }),
    ).rejects.toThrow(/per-module objects/);
    expect(emit).not.toHaveBeenCalled();
  });
});
