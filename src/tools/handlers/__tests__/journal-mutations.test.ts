import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import { FoundryClient } from '../../../foundry/client.js';
import type { WorldJournal } from '../../../foundry/types.js';
import {
  handleAddJournalPage,
  handleCreateJournalEntry,
  handleUpdateJournalEntry,
  handleUpdateJournalPage,
} from '../journal-mutations.js';

const VALID_FOLDER_ID = 'abcdefABCDEF0123';
const JOURNAL_ID = '0123456789abcdef';
const PAGE_ID = 'fedcba9876543210';
const WRITE_DISABLED =
  'Write operations are disabled. Set FOUNDRY_WRITE_ENABLED=true to allow game-state mutation.';

const sampleJournal: WorldJournal = {
  _id: '0123456789abcdef',
  name: 'Session 11 Recap',
  pages: [
    {
      _id: 'fedcba9876543210',
      name: 'Summary',
      type: 'text',
      text: { content: '<p>The party arrived in Terris.</p>', format: 1 },
    },
  ],
};

const createMockClient = (overrides: Partial<FoundryClient> = {}): FoundryClient => {
  return {
    createJournalEntry: vi.fn(async () => sampleJournal),
    getJournal: vi.fn(() => sampleJournal),
    updateJournalPage: vi.fn(async () => ({ _id: PAGE_ID })),
    appendJournalPage: vi.fn(async () => ({ _id: PAGE_ID })),
    addJournalPage: vi.fn(async () => ({ _id: 'newpage000000000', name: 'Loot' })),
    updateJournalEntry: vi.fn(async () => ({ _id: JOURNAL_ID })),
    ...overrides,
  } as unknown as FoundryClient;
};

describe('journal mutation handlers', () => {
  describe('handleCreateJournalEntry', () => {
    it('creates a journal entry with a single page', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: '<p>The party arrived in Terris.</p>' }],
        },
        mockClient,
      );

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Journal Entry Created');
      expect(result.content[0].text).toContain('Session 11 Recap');
      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: '<p>The party arrived in Terris.</p>' }],
        undefined,
        undefined,
      );
    });

    it('defaults to GM-only visibility and says so in the response', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
        mockClient,
      );
      expect(result.content[0].text).toContain('**Visible to:** GM only');
    });

    it('passes visibility through and reports player-readable', async () => {
      const mockClient = createMockClient();
      const result = await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: 'text' }],
          visibility: 'observer',
        },
        mockClient,
      );
      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'text' }],
        undefined,
        'observer',
      );
      expect(result.content[0].text).toContain('all players (read-only)');
    });

    it('rejects an unknown visibility with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          {
            name: 'Session 11 Recap',
            pages: [{ name: 'Summary', content: 'text' }],
            visibility: 'everyone' as unknown as 'observer',
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('passes an optional folder id through', async () => {
      const mockClient = createMockClient();
      await handleCreateJournalEntry(
        {
          name: 'Session 11 Recap',
          pages: [{ name: 'Summary', content: 'text' }],
          folder: VALID_FOLDER_ID,
        },
        mockClient,
      );

      expect(mockClient.createJournalEntry).toHaveBeenCalledWith(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'text' }],
        VALID_FOLDER_ID,
        undefined,
      );
    });

    it('rejects an empty name with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          { name: '', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('rejects an empty pages array with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry({ name: 'Session 11 Recap', pages: [] }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('rejects a page missing content with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleCreateJournalEntry(
          {
            name: 'Session 11 Recap',
            pages: [{ name: 'Summary' } as unknown as { name: string; content: string }],
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('propagates a client error', async () => {
      const mockClient = createMockClient({
        createJournalEntry: vi.fn(async () => {
          throw new Error('FoundryVTT rejected create JournalEntry: some failure');
        }),
      });
      await expect(
        handleCreateJournalEntry(
          { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('surfaces the write-disabled guard error', async () => {
      const mockClient = createMockClient({
        createJournalEntry: vi.fn(async () => {
          throw new Error(
            'Write operations are disabled. Set FOUNDRY_WRITE_ENABLED=true to allow game-state mutation.',
          );
        }),
      });
      await expect(
        handleCreateJournalEntry(
          { name: 'Session 11 Recap', pages: [{ name: 'Summary', content: 'text' }] },
          mockClient,
        ),
      ).rejects.toThrow('FOUNDRY_WRITE_ENABLED');
    });
  });

  describe('handleUpdateJournalPage', () => {
    it('replaces content and name by default (mode "replace")', async () => {
      const mockClient = createMockClient();
      const result = await handleUpdateJournalPage(
        { journalId: JOURNAL_ID, pageId: PAGE_ID, name: 'Recap', content: '<p>new</p>' },
        mockClient,
      );

      expect(mockClient.updateJournalPage).toHaveBeenCalledWith(JOURNAL_ID, PAGE_ID, {
        name: 'Recap',
        content: '<p>new</p>',
      });
      expect(mockClient.appendJournalPage).not.toHaveBeenCalled();
      const text = result.content[0].text;
      expect(text).toContain('Journal Page Updated');
      expect(text).toContain('Session 11 Recap');
      expect(text).toContain(PAGE_ID);
      expect(text).toContain('replace');
    });

    it('can rename a page without touching its content', async () => {
      const mockClient = createMockClient();
      await handleUpdateJournalPage(
        { journalId: JOURNAL_ID, pageId: PAGE_ID, name: 'Recap' },
        mockClient,
      );
      expect(mockClient.updateJournalPage).toHaveBeenCalledWith(JOURNAL_ID, PAGE_ID, {
        name: 'Recap',
      });
    });

    it('appends content in mode "append"', async () => {
      const mockClient = createMockClient();
      const result = await handleUpdateJournalPage(
        { journalId: JOURNAL_ID, pageId: PAGE_ID, mode: 'append', content: '<p>more</p>' },
        mockClient,
      );

      expect(mockClient.appendJournalPage).toHaveBeenCalledWith(JOURNAL_ID, PAGE_ID, '<p>more</p>');
      expect(mockClient.updateJournalPage).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('append');
    });

    it('rejects an unknown mode with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalPage(
          {
            journalId: JOURNAL_ID,
            pageId: PAGE_ID,
            mode: 'prepend' as unknown as 'append',
            content: 'x',
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('rejects a replace with neither name nor content', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalPage({ journalId: JOURNAL_ID, pageId: PAGE_ID }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('rejects an append without content', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalPage(
          { journalId: JOURNAL_ID, pageId: PAGE_ID, mode: 'append' },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('rejects a rename in append mode instead of silently ignoring it', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalPage(
          { journalId: JOURNAL_ID, pageId: PAGE_ID, mode: 'append', name: 'Recap', content: 'x' },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('rejects a missing pageId with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalPage({ journalId: JOURNAL_ID, pageId: '', content: 'x' }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('surfaces the write-disabled guard error', async () => {
      const mockClient = createMockClient({
        updateJournalPage: vi.fn(async () => {
          throw new Error(WRITE_DISABLED);
        }),
      });
      await expect(
        handleUpdateJournalPage(
          { journalId: JOURNAL_ID, pageId: PAGE_ID, content: 'x' },
          mockClient,
        ),
      ).rejects.toThrow('FOUNDRY_WRITE_ENABLED');
    });
  });

  describe('handleAddJournalPage', () => {
    it('adds a text page and reports its new id', async () => {
      const mockClient = createMockClient();
      const result = await handleAddJournalPage(
        { journalId: JOURNAL_ID, name: 'Loot', content: '<p>Rope</p>' },
        mockClient,
      );

      expect(mockClient.addJournalPage).toHaveBeenCalledWith(JOURNAL_ID, {
        name: 'Loot',
        content: '<p>Rope</p>',
      });
      const text = result.content[0].text;
      expect(text).toContain('Journal Page Added');
      expect(text).toContain('newpage000000000');
      expect(text).toContain('Session 11 Recap');
    });

    it('rejects an empty name with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleAddJournalPage({ journalId: JOURNAL_ID, name: '', content: 'x' }, mockClient),
      ).rejects.toThrow(McpError);
    });

    it('rejects a missing content with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleAddJournalPage(
          { journalId: JOURNAL_ID, name: 'Loot' } as unknown as {
            journalId: string;
            name: string;
            content: string;
          },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('surfaces the write-disabled guard error', async () => {
      const mockClient = createMockClient({
        addJournalPage: vi.fn(async () => {
          throw new Error(WRITE_DISABLED);
        }),
      });
      await expect(
        handleAddJournalPage({ journalId: JOURNAL_ID, name: 'Loot', content: 'x' }, mockClient),
      ).rejects.toThrow('FOUNDRY_WRITE_ENABLED');
    });
  });

  describe('handleUpdateJournalEntry', () => {
    it('passes only the supplied fields through', async () => {
      const mockClient = createMockClient();
      const result = await handleUpdateJournalEntry(
        { journalId: JOURNAL_ID, visibility: 'observer' },
        mockClient,
      );

      expect(mockClient.updateJournalEntry).toHaveBeenCalledWith(JOURNAL_ID, {
        visibility: 'observer',
      });
      const text = result.content[0].text;
      expect(text).toContain('Journal Entry Updated');
      expect(text).toContain('all players (read-only)');
    });

    it('renames and refiles an entry', async () => {
      const mockClient = createMockClient();
      await handleUpdateJournalEntry(
        { journalId: JOURNAL_ID, name: 'Session 12', folder: VALID_FOLDER_ID },
        mockClient,
      );
      expect(mockClient.updateJournalEntry).toHaveBeenCalledWith(JOURNAL_ID, {
        name: 'Session 12',
        folder: VALID_FOLDER_ID,
      });
    });

    it('rejects a call that changes nothing', async () => {
      const mockClient = createMockClient();
      await expect(handleUpdateJournalEntry({ journalId: JOURNAL_ID }, mockClient)).rejects.toThrow(
        McpError,
      );
    });

    it('rejects an unknown visibility with InvalidParams', async () => {
      const mockClient = createMockClient();
      await expect(
        handleUpdateJournalEntry(
          { journalId: JOURNAL_ID, visibility: 'everyone' as unknown as 'observer' },
          mockClient,
        ),
      ).rejects.toThrow(McpError);
    });

    it('surfaces the write-disabled guard error', async () => {
      const mockClient = createMockClient({
        updateJournalEntry: vi.fn(async () => {
          throw new Error(WRITE_DISABLED);
        }),
      });
      await expect(
        handleUpdateJournalEntry({ journalId: JOURNAL_ID, name: 'Session 12' }, mockClient),
      ).rejects.toThrow('FOUNDRY_WRITE_ENABLED');
    });
  });
});

// ----------------------------------------------------------------------------
// Client-level: exercises the real createJournalEntry over a mocked Socket.IO
// socket (modifyDocument protocol).
// ----------------------------------------------------------------------------
describe('FoundryClient journal mutations (modifyDocument)', () => {
  type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;

  const buildClient = (opts: { writeEnabled?: boolean; connected?: boolean } = {}) => {
    const client = new FoundryClient({
      baseUrl: 'http://localhost:30000',
      writeEnabled: opts.writeEnabled ?? true,
    });
    const emit = vi.fn(((_event, payload, cb) => {
      const op = (payload as { operation?: { data?: unknown[] } }).operation;
      const echoed = op?.data?.[0];
      cb({ result: echoed ? [echoed] : [] });
    }) as SocketEmitMock);
    if (opts.connected !== false) {
      (client as unknown as { socket: { connected: boolean; emit: SocketEmitMock } }).socket = {
        connected: true,
        emit,
      };
    }
    return client;
  };

  const lastRequest = (client: FoundryClient) => {
    const emitMock = (client as unknown as { socket: { emit: ReturnType<typeof vi.fn> } }).socket
      .emit;
    return emitMock.mock.calls[0];
  };

  it('creates a top-level JournalEntry modifyDocument request with no parentUuid', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: '<p>The party arrived in Terris.</p>' },
    ]);
    const [event, body] = lastRequest(client);
    expect(event).toBe('modifyDocument');
    expect(body).toMatchObject({
      type: 'JournalEntry',
      action: 'create',
      operation: {
        data: [
          {
            name: 'Session 11 Recap',
            pages: [
              {
                name: 'Summary',
                type: 'text',
                text: { content: '<p>The party arrived in Terris.</p>', format: 1 },
                sort: 100000,
              },
            ],
          },
        ],
        broadcast: true,
        pack: null,
      },
    });
    expect(body.operation.parentUuid).toBeUndefined();
  });

  it('maps multiple pages in order', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: 'a' },
      { name: 'NPCs', content: 'b' },
    ]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].pages).toHaveLength(2);
    expect(body.operation.data[0].pages[0].name).toBe('Summary');
    expect(body.operation.data[0].pages[1].name).toBe('NPCs');
  });

  it('assigns ascending sort values so pages render in the supplied order', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [
      { name: 'Summary', content: 'a' },
      { name: 'NPCs', content: 'b' },
      { name: 'Loot', content: 'c' },
    ]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].pages.map((p: { sort: number }) => p.sort)).toEqual([
      100000, 200000, 300000,
    ]);
  });

  it('includes folder when provided', async () => {
    const client = buildClient();
    await client.createJournalEntry(
      'Session 11 Recap',
      [{ name: 'Summary', content: 'a' }],
      VALID_FOLDER_ID,
    );
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].folder).toBe(VALID_FOLDER_ID);
  });

  it('omits ownership entirely when no visibility is given, leaving Foundry to default it', async () => {
    const client = buildClient();
    await client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]);
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].ownership).toBeUndefined();
  });

  it.each([
    ['observer', 2],
    ['owner', 3],
    ['gm-only', 0],
  ] as const)('maps visibility %s to ownership.default %i', async (visibility, level) => {
    const client = buildClient();
    await client.createJournalEntry(
      'Session 11 Recap',
      [{ name: 'Summary', content: 'a' }],
      undefined,
      visibility,
    );
    const [, body] = lastRequest(client);
    expect(body.operation.data[0].ownership).toEqual({ default: level });
  });

  it('rejects an unknown visibility before emitting', async () => {
    const client = buildClient();
    await expect(
      client.createJournalEntry(
        'Session 11 Recap',
        [{ name: 'Summary', content: 'a' }],
        undefined,
        'everyone' as unknown as 'observer',
      ),
    ).rejects.toThrow(/Invalid visibility/);
  });

  it('rejects an empty pages array before emitting', async () => {
    const client = buildClient();
    await expect(client.createJournalEntry('Session 11 Recap', [])).rejects.toThrow(
      /at least one page/,
    );
  });

  it('rejects a malformed folder id before emitting', async () => {
    const client = buildClient();
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }], 'short'),
    ).rejects.toThrow(/Invalid folder/);
  });

  it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
    const client = buildClient({ writeEnabled: false });
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]),
    ).rejects.toThrow(/FOUNDRY_WRITE_ENABLED/);
  });

  it('rejects writes when the socket is not connected', async () => {
    const client = buildClient({ connected: false });
    await expect(
      client.createJournalEntry('Session 11 Recap', [{ name: 'Summary', content: 'a' }]),
    ).rejects.toThrow(/Socket\.IO connection/);
  });
});

// ----------------------------------------------------------------------------
// Client-level page/entry editing: real FoundryClient over a mocked socket that
// echoes the request back the way Foundry answers it, with a cached worldData so
// the write-through cache update can be asserted.
// ----------------------------------------------------------------------------
describe('FoundryClient journal page editing (modifyDocument)', () => {
  type SocketEmitMock = (event: string, payload: unknown, cb: (response: unknown) => void) => void;
  type Operation = { data?: Array<Record<string, unknown>>; updates?: unknown[] };

  const buildWorldJournal = (): WorldJournal => ({
    _id: JOURNAL_ID,
    name: 'Session 11 Recap',
    pages: [
      {
        _id: PAGE_ID,
        name: 'Summary',
        type: 'text',
        text: { content: '<p>The party arrived in Terris.</p>', format: 1 },
        sort: 100000,
      },
      {
        _id: 'aaaaaaaaaaaaaaa2',
        name: 'NPCs',
        type: 'text',
        text: { content: '<p>Mira</p>', format: 1 },
        sort: 200000,
      },
    ],
  });

  const buildClient = (opts: { writeEnabled?: boolean; journal?: WorldJournal | null } = {}) => {
    const client = new FoundryClient({
      baseUrl: 'http://localhost:30000',
      writeEnabled: opts.writeEnabled ?? true,
    });
    const emit = vi.fn(((_event, payload, cb) => {
      const op = (payload as { operation: Operation }).operation;
      if (op.updates) {
        cb({ result: op.updates });
        return;
      }
      cb({ result: (op.data ?? []).map((d) => ({ _id: 'newpage000000000', ...d })) });
    }) as SocketEmitMock);
    const internals = client as unknown as {
      socket: { connected: boolean; emit: SocketEmitMock };
      worldData: { journal: WorldJournal[] };
    };
    internals.socket = { connected: true, emit };
    internals.worldData = {
      journal: opts.journal === null ? [] : [opts.journal ?? buildWorldJournal()],
    };
    return { client, emit };
  };

  const cachedPage = (client: FoundryClient, pageId = PAGE_ID) =>
    client.getJournal(JOURNAL_ID)?.pages?.find((p) => p._id === pageId);

  describe('updateJournalPage', () => {
    it('sends a JournalEntryPage update scoped to the parent entry', async () => {
      const { client, emit } = buildClient();
      await client.updateJournalPage(JOURNAL_ID, PAGE_ID, { name: 'Recap', content: '<p>new</p>' });

      const [event, body] = emit.mock.calls[0];
      expect(event).toBe('modifyDocument');
      expect(body).toMatchObject({
        type: 'JournalEntryPage',
        action: 'update',
        operation: {
          updates: [{ _id: PAGE_ID, name: 'Recap', 'text.content': '<p>new</p>' }],
          parentUuid: `JournalEntry.${JOURNAL_ID}`,
          diff: true,
          broadcast: true,
        },
      });
    });

    it('omits the fields that were not supplied', async () => {
      const { client, emit } = buildClient();
      await client.updateJournalPage(JOURNAL_ID, PAGE_ID, { name: 'Recap' });

      const [, body] = emit.mock.calls[0];
      expect(body.operation.updates).toEqual([{ _id: PAGE_ID, name: 'Recap' }]);
    });

    it('updates the cached page so a following get_journal sees the change', async () => {
      const { client } = buildClient();
      await client.updateJournalPage(JOURNAL_ID, PAGE_ID, { content: '<p>new</p>' });

      expect(cachedPage(client)).toMatchObject({
        name: 'Summary',
        text: { content: '<p>new</p>', format: 1 },
      });
    });

    it('rejects an update that changes nothing', async () => {
      const { client, emit } = buildClient();
      await expect(client.updateJournalPage(JOURNAL_ID, PAGE_ID, {})).rejects.toThrow(
        /name or content/,
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it.each([
      ['journalId', 'short', PAGE_ID],
      ['pageId', JOURNAL_ID, 'short'],
    ])('rejects a malformed %s before emitting', async (field, journalId, pageId) => {
      const { client, emit } = buildClient();
      await expect(client.updateJournalPage(journalId, pageId, { name: 'x' })).rejects.toThrow(
        new RegExp(`Invalid ${field}`),
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
      const { client, emit } = buildClient({ writeEnabled: false });
      await expect(client.updateJournalPage(JOURNAL_ID, PAGE_ID, { name: 'x' })).rejects.toThrow(
        /FOUNDRY_WRITE_ENABLED/,
      );
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('appendJournalPage', () => {
    it('appends to the cached page content and sends the combined HTML', async () => {
      const { client, emit } = buildClient();
      await client.appendJournalPage(JOURNAL_ID, PAGE_ID, '<p>They met Mira.</p>');

      const [, body] = emit.mock.calls[0];
      expect(body.operation.updates).toEqual([
        {
          _id: PAGE_ID,
          'text.content': '<p>The party arrived in Terris.</p><p>They met Mira.</p>',
        },
      ]);
      expect(cachedPage(client)?.text?.content).toBe(
        '<p>The party arrived in Terris.</p><p>They met Mira.</p>',
      );
    });

    it('fails clearly when the page is not in the journal', async () => {
      const { client, emit } = buildClient();
      await expect(
        client.appendJournalPage(JOURNAL_ID, 'zzzzzzzzzzzzzzzz', '<p>x</p>'),
      ).rejects.toThrow(`Journal page not found: zzzzzzzzzzzzzzzz in journal ${JOURNAL_ID}`);
      expect(emit).not.toHaveBeenCalled();
    });

    it('fails clearly when the journal is not cached', async () => {
      const { client, emit } = buildClient({ journal: null });
      await expect(client.appendJournalPage(JOURNAL_ID, PAGE_ID, '<p>x</p>')).rejects.toThrow(
        `Journal not found: ${JOURNAL_ID}`,
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects empty html', async () => {
      const { client } = buildClient();
      await expect(client.appendJournalPage(JOURNAL_ID, PAGE_ID, '')).rejects.toThrow(/html/);
    });

    it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
      const { client } = buildClient({ writeEnabled: false });
      await expect(client.appendJournalPage(JOURNAL_ID, PAGE_ID, '<p>x</p>')).rejects.toThrow(
        /FOUNDRY_WRITE_ENABLED/,
      );
    });
  });

  describe('addJournalPage', () => {
    it('creates a text page sorted after the last existing page', async () => {
      const { client, emit } = buildClient();
      await client.addJournalPage(JOURNAL_ID, { name: 'Loot', content: '<p>Rope</p>' });

      const [, body] = emit.mock.calls[0];
      expect(body).toMatchObject({
        type: 'JournalEntryPage',
        action: 'create',
        operation: {
          data: [
            {
              name: 'Loot',
              type: 'text',
              text: { content: '<p>Rope</p>', format: 1 },
              sort: 300000,
            },
          ],
          parentUuid: `JournalEntry.${JOURNAL_ID}`,
        },
      });
    });

    it('uses the first sort slot for an entry without pages', async () => {
      const { client, emit } = buildClient({
        journal: { _id: JOURNAL_ID, name: 'Empty', pages: [] },
      });
      await client.addJournalPage(JOURNAL_ID, { name: 'Loot', content: 'x' });

      const [, body] = emit.mock.calls[0];
      expect(body.operation.data[0].sort).toBe(100000);
    });

    it('adds the created page to the cached journal', async () => {
      const { client } = buildClient();
      const page = await client.addJournalPage(JOURNAL_ID, { name: 'Loot', content: 'x' });

      expect(page).toMatchObject({ _id: 'newpage000000000', name: 'Loot' });
      expect(client.getJournal(JOURNAL_ID)?.pages).toHaveLength(3);
    });

    it('fails clearly when the journal is not cached', async () => {
      const { client, emit } = buildClient({ journal: null });
      await expect(
        client.addJournalPage(JOURNAL_ID, { name: 'Loot', content: 'x' }),
      ).rejects.toThrow(`Journal not found: ${JOURNAL_ID}`);
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects a missing name before emitting', async () => {
      const { client, emit } = buildClient();
      await expect(client.addJournalPage(JOURNAL_ID, { name: '', content: 'x' })).rejects.toThrow(
        /name/,
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
      const { client } = buildClient({ writeEnabled: false });
      await expect(
        client.addJournalPage(JOURNAL_ID, { name: 'Loot', content: 'x' }),
      ).rejects.toThrow(/FOUNDRY_WRITE_ENABLED/);
    });
  });

  describe('updateJournalEntry', () => {
    it('sends a top-level JournalEntry update with name and folder', async () => {
      const { client, emit } = buildClient();
      await client.updateJournalEntry(JOURNAL_ID, { name: 'Session 12', folder: VALID_FOLDER_ID });

      const [, body] = emit.mock.calls[0];
      expect(body).toMatchObject({
        type: 'JournalEntry',
        action: 'update',
        operation: {
          updates: [{ _id: JOURNAL_ID, name: 'Session 12', folder: VALID_FOLDER_ID }],
          diff: true,
        },
      });
      expect(body.operation.parentUuid).toBeUndefined();
    });

    it.each([
      ['observer', 2],
      ['owner', 3],
      ['gm-only', 0],
    ] as const)('maps visibility %s to ownership.default %i', async (visibility, level) => {
      const { client, emit } = buildClient();
      await client.updateJournalEntry(JOURNAL_ID, { visibility });

      const [, body] = emit.mock.calls[0];
      expect(body.operation.updates).toEqual([{ _id: JOURNAL_ID, ownership: { default: level } }]);
    });

    it('updates the cached entry', async () => {
      const { client } = buildClient();
      await client.updateJournalEntry(JOURNAL_ID, { name: 'Session 12' });

      expect(client.getJournal(JOURNAL_ID)?.name).toBe('Session 12');
      expect(client.getJournal(JOURNAL_ID)?.pages).toHaveLength(2);
    });

    it('rejects an update that changes nothing', async () => {
      const { client, emit } = buildClient();
      await expect(client.updateJournalEntry(JOURNAL_ID, {})).rejects.toThrow(
        /name, folder or visibility/,
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('rejects an unknown visibility before emitting', async () => {
      const { client } = buildClient();
      await expect(
        client.updateJournalEntry(JOURNAL_ID, {
          visibility: 'everyone' as unknown as 'observer',
        }),
      ).rejects.toThrow(/Invalid visibility/);
    });

    it('rejects a malformed folder id before emitting', async () => {
      const { client } = buildClient();
      await expect(client.updateJournalEntry(JOURNAL_ID, { folder: 'short' })).rejects.toThrow(
        /Invalid folder/,
      );
    });

    it('rejects a malformed journalId before emitting', async () => {
      const { client } = buildClient();
      await expect(client.updateJournalEntry('short', { name: 'x' })).rejects.toThrow(
        /Invalid journalId/,
      );
    });

    it('rejects writes when FOUNDRY_WRITE_ENABLED is false', async () => {
      const { client } = buildClient({ writeEnabled: false });
      await expect(client.updateJournalEntry(JOURNAL_ID, { name: 'x' })).rejects.toThrow(
        /FOUNDRY_WRITE_ENABLED/,
      );
    });
  });
});
