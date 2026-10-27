/**
 * @fileoverview ModuleBridge connection handling over a real local WebSocket:
 * which module connection becomes the bridge.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { ModuleBridge, NOT_BRIDGE_USER_CLOSE_CODE } = await import('../module-bridge.js');

const BRIDGE_USER = 'mcpapi0000000000';
const HUMAN_GM = 'humangm000000000';

let bridge: InstanceType<typeof ModuleBridge> | null = null;
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const ws of clients.splice(0)) {
    ws.terminate();
  }
  await bridge?.stop();
  bridge = null;
});

/** Starts a bridge on a free port; `helloTimeoutMs` kept short for the tests. */
async function startBridge(acceptUserId?: string) {
  bridge = new ModuleBridge(0, 1000, 200);
  if (acceptUserId) {
    bridge.acceptUser = (userId) => userId === acceptUserId;
  }
  await bridge.start();
  const port = (bridge as unknown as { wss: { address(): { port: number } } }).wss.address().port;
  return { bridge, port };
}

/**
 * Connects a fake module that answers `capture_scene` with its own name and,
 * when given a userId, says hello first. Resolves once the socket is open.
 */
async function connectModule(port: number, name: string, userId?: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  clients.push(ws);
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as { id: string };
    ws.send(JSON.stringify({ id: msg.id, result: name }));
  });
  await new Promise((resolve) => ws.on('open', resolve));
  if (userId) {
    ws.send(JSON.stringify({ event: 'hello', payload: { userId } }));
  }
  return { ws, closed };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
};

describe('ModuleBridge without a bridge user', () => {
  it('uses the newest connection, as before', async () => {
    const { bridge, port } = await startBridge();
    await connectModule(port, 'first');
    const second = await connectModule(port, 'second');
    await until(() => bridge.isConnected());
    await expect(bridge.send('capture_scene')).resolves.toBe('second');
    second.ws.close();
  });
});

describe('ModuleBridge with a bridge user', () => {
  it("adopts the accepted user's module after its hello", async () => {
    const { bridge, port } = await startBridge(BRIDGE_USER);
    await connectModule(port, 'headless', BRIDGE_USER);
    await until(() => bridge.isConnected());
    await expect(bridge.send('capture_scene')).resolves.toBe('headless');
  });

  it("refuses another GM's module without dropping the bridge", async () => {
    const { bridge, port } = await startBridge(BRIDGE_USER);
    await connectModule(port, 'headless', BRIDGE_USER);
    await until(() => bridge.isConnected());

    const human = await connectModule(port, 'human', HUMAN_GM);
    await expect(human.closed).resolves.toBe(NOT_BRIDGE_USER_CLOSE_CODE);
    await expect(bridge.send('capture_scene')).resolves.toBe('headless');
  });

  it('refuses a module that never says hello', async () => {
    const { bridge, port } = await startBridge(BRIDGE_USER);
    const legacy = await connectModule(port, 'legacy');
    await expect(legacy.closed).resolves.toBe(NOT_BRIDGE_USER_CLOSE_CODE);
    expect(bridge.isConnected()).toBe(false);
  });

  it('does not pass the hello on as a module event', async () => {
    const { bridge, port } = await startBridge(BRIDGE_USER);
    const onEvent = vi.fn();
    bridge.onEvent = onEvent;
    const headless = await connectModule(port, 'headless', BRIDGE_USER);
    await until(() => bridge.isConnected());
    headless.ws.send(JSON.stringify({ event: 'hello', payload: { userId: BRIDGE_USER } }));
    headless.ws.send(JSON.stringify({ event: 'target_token', payload: { tokenId: 't' } }));
    await until(() => onEvent.mock.calls.length > 0);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith('target_token', { tokenId: 't' });
  });
});
