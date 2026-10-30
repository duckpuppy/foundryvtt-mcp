/**
 * @fileoverview Journal entry and page mutation tool handlers
 *
 * WRITE operations — require FOUNDRY_WRITE_ENABLED=true and an active Socket.IO
 * connection (mutations use the core `modifyDocument` protocol). `JournalEntry`
 * is a top-level document, so entry writes have no parent to scope them to;
 * `JournalEntryPage` writes are scoped to their parent entry.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { FoundryClient } from '../../foundry/client.js';
import type {
  DocumentVisibility,
  JournalEntryUpdate,
  JournalPageCreateSource,
  JournalPageUpdate,
} from '../../foundry/types.js';
import { VISIBILITY_LEVELS } from '../../foundry/types.js';
import { withToolError } from './utils.js';

/** Human-readable summary of who can see the entry, for the tool response. */
const VISIBILITY_SUMMARY: Record<DocumentVisibility, string> = {
  'gm-only': 'GM only',
  observer: 'all players (read-only)',
  owner: 'all players (read/write)',
};

/**
 * Handles creating a journal entry with one or more text pages.
 */
export async function handleCreateJournalEntry(
  args: {
    name: string;
    pages: JournalPageCreateSource[];
    folder?: string;
    visibility?: DocumentVisibility;
  },
  foundryClient: FoundryClient,
) {
  const { name, pages, folder, visibility } = args;

  if (!name || typeof name !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'name is required and must be a string');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'pages is required and must contain at least one page',
    );
  }
  for (const page of pages) {
    if (
      !page ||
      typeof page !== 'object' ||
      typeof page.name !== 'string' ||
      typeof page.content !== 'string'
    ) {
      throw new McpError(ErrorCode.InvalidParams, 'each page requires a name and content string');
    }
  }
  if (visibility !== undefined && !(visibility in VISIBILITY_LEVELS)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `visibility must be one of: ${Object.keys(VISIBILITY_LEVELS).join(', ')}`,
    );
  }

  return withToolError('create journal entry', async () => {
    const journal = await foundryClient.createJournalEntry(name, pages, folder, visibility);

    return {
      content: [
        {
          type: 'text',
          text: `📓 **Journal Entry Created**
**Name:** ${journal.name}
**ID:** ${journal._id}
**Pages:** ${journal.pages?.length ?? pages.length}
**Visible to:** ${VISIBILITY_SUMMARY[visibility ?? 'gm-only']}`,
        },
      ],
    };
  });
}

/** How update_journal_page applies `content`. */
export type JournalPageUpdateMode = 'replace' | 'append';

const PAGE_UPDATE_MODES: readonly JournalPageUpdateMode[] = ['replace', 'append'];

function requireId(value: unknown, field: string): void {
  if (!value || typeof value !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, `${field} is required and must be a string`);
  }
}

/**
 * Handles editing one page of a journal entry: replacing its name and/or
 * content, or appending HTML to the end of its content.
 */
export async function handleUpdateJournalPage(
  args: {
    journalId: string;
    pageId: string;
    mode?: JournalPageUpdateMode;
    name?: string;
    content?: string;
  },
  foundryClient: FoundryClient,
) {
  const { journalId, pageId, name, content } = args;
  const mode = args.mode ?? 'replace';

  requireId(journalId, 'journalId');
  requireId(pageId, 'pageId');
  if (!PAGE_UPDATE_MODES.includes(mode)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `mode must be one of: ${PAGE_UPDATE_MODES.join(', ')}`,
    );
  }
  if (name !== undefined && (typeof name !== 'string' || !name)) {
    throw new McpError(ErrorCode.InvalidParams, 'name must be a non-empty string');
  }
  if (content !== undefined && typeof content !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'content must be a string');
  }
  if (mode === 'append') {
    if (!content) {
      throw new McpError(ErrorCode.InvalidParams, 'append mode requires non-empty content');
    }
    if (name !== undefined) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'name cannot be changed in append mode - use mode "replace" to rename the page',
      );
    }
  } else if (name === undefined && content === undefined) {
    throw new McpError(ErrorCode.InvalidParams, 'replace mode requires a name or content');
  }

  return withToolError('update journal page', async () => {
    if (mode === 'append') {
      await foundryClient.appendJournalPage(journalId, pageId, content as string);
    } else {
      const patch: JournalPageUpdate = {};
      if (name !== undefined) {
        patch.name = name;
      }
      if (content !== undefined) {
        patch.content = content;
      }
      await foundryClient.updateJournalPage(journalId, pageId, patch);
    }

    // The write has already been applied to the cache, so this reads the result.
    const journal = foundryClient.getJournal(journalId);
    const page = journal?.pages?.find((p) => p._id === pageId);

    return {
      content: [
        {
          type: 'text',
          text: `📝 **Journal Page Updated**
**Journal:** ${journal?.name ?? journalId} (${journalId})
**Page:** ${page?.name ?? pageId} (${pageId})
**Mode:** ${mode}`,
        },
      ],
    };
  });
}

/**
 * Handles adding a new text page to an existing journal entry.
 */
export async function handleAddJournalPage(
  args: { journalId: string; name: string; content: string },
  foundryClient: FoundryClient,
) {
  const { journalId, name, content } = args;

  requireId(journalId, 'journalId');
  if (!name || typeof name !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'name is required and must be a string');
  }
  if (typeof content !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'content is required and must be a string');
  }

  return withToolError('add journal page', async () => {
    const page = await foundryClient.addJournalPage(journalId, { name, content });
    const journal = foundryClient.getJournal(journalId);

    return {
      content: [
        {
          type: 'text',
          text: `📄 **Journal Page Added**
**Journal:** ${journal?.name ?? journalId} (${journalId})
**Page:** ${page?.name ?? name} (${page?._id ?? 'unknown id'})`,
        },
      ],
    };
  });
}

/**
 * Handles renaming, refiling, or changing the visibility of a journal entry.
 */
export async function handleUpdateJournalEntry(
  args: {
    journalId: string;
    name?: string;
    folder?: string;
    visibility?: DocumentVisibility;
  },
  foundryClient: FoundryClient,
) {
  const { journalId, name, folder, visibility } = args;

  requireId(journalId, 'journalId');
  if (name === undefined && folder === undefined && visibility === undefined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'at least one of name, folder or visibility is required',
    );
  }
  if (name !== undefined && (typeof name !== 'string' || !name)) {
    throw new McpError(ErrorCode.InvalidParams, 'name must be a non-empty string');
  }
  if (folder !== undefined && typeof folder !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'folder must be a string');
  }
  if (visibility !== undefined && !(visibility in VISIBILITY_LEVELS)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `visibility must be one of: ${Object.keys(VISIBILITY_LEVELS).join(', ')}`,
    );
  }

  return withToolError('update journal entry', async () => {
    const patch: JournalEntryUpdate = {};
    if (name !== undefined) {
      patch.name = name;
    }
    if (folder !== undefined) {
      patch.folder = folder;
    }
    if (visibility !== undefined) {
      patch.visibility = visibility;
    }
    await foundryClient.updateJournalEntry(journalId, patch);
    const journal = foundryClient.getJournal(journalId);

    const lines = [
      '📓 **Journal Entry Updated**',
      `**Entry:** ${journal?.name ?? name ?? journalId} (${journalId})`,
    ];
    if (folder !== undefined) {
      lines.push(`**Folder:** ${folder}`);
    }
    if (visibility !== undefined) {
      lines.push(`**Visible to:** ${VISIBILITY_SUMMARY[visibility]}`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  });
}

/**
 * Handles permanently deleting a journal entry.
 */
export async function handleDeleteJournalEntry(
  args: { journalId: string },
  foundryClient: FoundryClient,
) {
  const { journalId } = args;

  if (!journalId || typeof journalId !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'journalId is required and must be a string');
  }

  return withToolError('delete journal entry', async () => {
    const target = foundryClient.getJournal(journalId);
    const name = target?.name ?? journalId;
    await foundryClient.deleteJournalEntry(journalId);

    return {
      content: [
        { type: 'text', text: `🗑️ **Journal Entry Deleted**\n**Entry:** ${name} (${journalId})` },
      ],
    };
  });
}
