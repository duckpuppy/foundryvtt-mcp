/**
 * @fileoverview Tests for per-token actor data on unlinked tokens (FoundryVTT
 * v14 ActorDelta) and for status effects that the dnd5e sheet recognises.
 */

import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../client.js';

const SCENE_ID = 'ssssssssssssssss';
const TOKEN_ID = 'tttttttttttttttt';
const LINKED_TOKEN_ID = 'llllllllllllllll';
const ACTOR_ID = 'aaaaaaaaaaaaaaaa';
const DELTA_ID = 'dddddddddddddddd';

type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

/**
 * A drake base actor at 22/22 HP, one unlinked token whose delta has it at
 * 13 HP, and one linked token. The socket echoes the first update/create back.
 */
const buildClient = (opts: { systemId?: string; delta?: Record<string, unknown> } = {}) => {
  const client = new FoundryClient({ baseUrl: 'http://localhost:30000', writeEnabled: true });
  const emit = vi.fn(((_event, payload, cb) => {
    const op = (
      payload as {
        operation?: {
          updates?: Array<Record<string, unknown>>;
          data?: Array<Record<string, unknown>>;
        };
      }
    ).operation;
    const result = op?.updates ?? op?.data ?? [];
    cb({ result: [result[0] ?? {}] });
  }) as SocketEmitMock);
  const internals = client as unknown as {
    socket: { connected: boolean; emit: SocketEmitMock };
    worldData: Record<string, unknown>;
  };
  internals.socket = { connected: true, emit };
  internals.worldData = {
    system: { id: opts.systemId ?? 'dnd5e' },
    actors: [
      {
        _id: ACTOR_ID,
        name: 'Ambush Drake',
        type: 'npc',
        system: { attributes: { hp: { value: 22, max: 22 }, ac: { flat: 13 } } },
        effects: [],
      },
    ],
    scenes: [
      {
        _id: SCENE_ID,
        name: 'Lodge',
        tokens: [
          {
            _id: TOKEN_ID,
            name: 'Ambush Drake',
            actorId: ACTOR_ID,
            actorLink: false,
            delta: opts.delta ?? { _id: TOKEN_ID, system: { attributes: { hp: { value: 13 } } } },
          },
          { _id: LINKED_TOKEN_ID, name: 'Drake (linked)', actorId: ACTOR_ID, actorLink: true },
        ],
      },
    ],
    items: [],
    combats: [],
  };
  return { client, emit };
};

const firstBody = (emit: ReturnType<typeof vi.fn>) =>
  (emit.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

describe('FoundryClient.getTokenActorSystem', () => {
  it("merges an unlinked token's delta over its base actor", () => {
    const { client } = buildClient();
    expect(client.getTokenActorSystem(TOKEN_ID, SCENE_ID)).toEqual({
      attributes: { hp: { value: 13, max: 22 }, ac: { flat: 13 } },
    });
  });

  it('does not change the cached base actor', () => {
    const { client } = buildClient();
    client.getTokenActorSystem(TOKEN_ID, SCENE_ID);
    expect(client.getRawActor(ACTOR_ID)?.system).toMatchObject({
      attributes: { hp: { value: 22 } },
    });
  });

  it("returns the world actor's system for a linked token", () => {
    const { client } = buildClient();
    expect(client.getTokenActorSystem(LINKED_TOKEN_ID, SCENE_ID)).toMatchObject({
      attributes: { hp: { value: 22, max: 22 } },
    });
  });

  it('returns undefined for an unknown token', () => {
    const { client } = buildClient();
    expect(client.getTokenActorSystem('xxxxxxxxxxxxxxxx', SCENE_ID)).toBeUndefined();
  });
});

describe('FoundryClient.updateTokenActorAttribute', () => {
  it("sends an unlinked token's change as an ActorDelta update parented to the token", async () => {
    const { client, emit } = buildClient({
      delta: { _id: DELTA_ID, system: { attributes: { hp: { value: 13 } } } },
    });
    await client.updateTokenActorAttribute(SCENE_ID, TOKEN_ID, { 'attributes.hp.value': 9 });
    expect(firstBody(emit)).toMatchObject({
      type: 'ActorDelta',
      action: 'update',
      operation: {
        updates: [{ _id: DELTA_ID, 'system.attributes.hp.value': 9 }],
        parentUuid: `Scene.${SCENE_ID}.Token.${TOKEN_ID}`,
        syntheticActorUpdate: true,
      },
    });
  });

  it("falls back to the token's id when the delta has no id", async () => {
    const { client, emit } = buildClient({ delta: {} });
    await client.updateTokenActorAttribute(SCENE_ID, TOKEN_ID, { 'attributes.hp.value': 9 });
    expect(firstBody(emit)).toMatchObject({
      operation: { updates: [{ _id: TOKEN_ID }] },
    });
  });

  it("checks HP against the token's own max", async () => {
    const { client, emit } = buildClient();
    await expect(
      client.updateTokenActorAttribute(SCENE_ID, TOKEN_ID, { 'attributes.hp.value': 23 }),
    ).rejects.toThrow(/exceeds max/);
    expect(emit).not.toHaveBeenCalled();
  });

  it('updates the world actor for a linked token', async () => {
    const { client, emit } = buildClient();
    await client.updateTokenActorAttribute(SCENE_ID, LINKED_TOKEN_ID, {
      'attributes.hp.value': 20,
    });
    expect(firstBody(emit)).toMatchObject({
      type: 'Actor',
      action: 'update',
      operation: { updates: [{ _id: ACTOR_ID }] },
    });
  });

  it('rejects a token that is not in the cache', async () => {
    const { client } = buildClient();
    await expect(
      client.updateTokenActorAttribute(SCENE_ID, 'xxxxxxxxxxxxxxxx', { 'attributes.hp.value': 1 }),
    ).rejects.toThrow(/Token not found/);
  });
});

describe('FoundryClient.createActorStatusEffect', () => {
  const tokenActorUuid = `Scene.${SCENE_ID}.Token.${TOKEN_ID}.Actor.${ACTOR_ID}`;

  it("uses dnd5e's static condition id, name and icon, and keeps the id", async () => {
    const { client, emit } = buildClient();
    await client.createActorStatusEffect(tokenActorUuid, 'prone');
    expect(firstBody(emit)).toMatchObject({
      type: 'ActiveEffect',
      action: 'create',
      operation: {
        data: [
          {
            _id: 'dnd5eprone000000',
            name: 'Prone',
            statuses: ['prone'],
            img: 'systems/dnd5e/icons/svg/statuses/prone.svg',
            showIcon: 2,
          },
        ],
        parentUuid: `Scene.${SCENE_ID}.Token.${TOKEN_ID}.ActorDelta.${TOKEN_ID}`,
        keepId: true,
      },
    });
  });

  it('cuts a long dnd5e static id to 16 characters', async () => {
    const { client, emit } = buildClient();
    await client.createActorStatusEffect(tokenActorUuid, 'incapacitated');
    const data = (firstBody(emit).operation as { data: Array<Record<string, unknown>> }).data;
    expect(data[0]?._id).toBe('dnd5eincapacitat');
  });

  it('names a camelCase status icon in kebab case', async () => {
    const { client, emit } = buildClient();
    await client.createActorStatusEffect(tokenActorUuid, 'coverHalf');
    const data = (firstBody(emit).operation as { data: Array<Record<string, unknown>> }).data;
    expect(data[0]?.img).toBe('systems/dnd5e/icons/svg/statuses/cover-half.svg');
  });

  it('keeps a caller-supplied name and icon', async () => {
    const { client, emit } = buildClient();
    await client.createActorStatusEffect(tokenActorUuid, 'prone', { name: 'Down', img: 'x.png' });
    const data = (firstBody(emit).operation as { data: Array<Record<string, unknown>> }).data;
    expect(data[0]).toMatchObject({ _id: 'dnd5eprone000000', name: 'Down', img: 'x.png' });
  });

  it('uses no static id outside dnd5e but still always shows the icon', async () => {
    const { client, emit } = buildClient({ systemId: 'pf2e' });
    await client.createActorStatusEffect(tokenActorUuid, 'prone');
    const body = firstBody(emit);
    const data = (body.operation as { data: Array<Record<string, unknown>> }).data;
    expect(data[0]).toEqual({ name: 'prone', statuses: ['prone'], showIcon: 2 });
    expect(body.operation).not.toHaveProperty('keepId');
  });

  it("parents the effect to the delta's own id when it has one", async () => {
    const { client, emit } = buildClient({ delta: { _id: DELTA_ID } });
    await client.createActorStatusEffect(tokenActorUuid, 'prone');
    expect(firstBody(emit)).toMatchObject({
      operation: { parentUuid: `Scene.${SCENE_ID}.Token.${TOKEN_ID}.ActorDelta.${DELTA_ID}` },
    });
  });
});
