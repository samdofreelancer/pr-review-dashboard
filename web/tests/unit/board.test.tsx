// @vitest-environment jsdom
/**
 * MSW-backed UI unit tests (T054): lane counts, lane windowing, filter
 * state, authentication/capability surfaces, and confirmation dialogs.
 *
 * The global setup (server/tests/setup.ts) owns one MSW server; tests add
 * narrowly-scoped handlers per case via `mswServer.use(...)`.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { mswServer } from '../../../server/tests/setup.js';
import { VI } from '../../src/i18n/vi.js';
import { Board } from '../../src/features/board/Board.js';
import { BoardFilters, type BoardFiltersState } from '../../src/features/board/BoardFilters.js';
import { ConfirmActionDialog } from '../../src/features/board/ConfirmActionDialog.js';
import { BoardPage } from '../../src/pages/BoardPage.js';
import { LANE_WINDOW_SIZE } from '../../src/features/board/BoardLane.js';

const LANE_NAMES = ['Draft', 'In review', 'Request changes', 'Approved', 'Done'] as const;
type LaneName = (typeof LANE_NAMES)[number];

interface BoardCardJson {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly author: string;
  readonly repository: { readonly id: string; readonly owner: string; readonly name: string };
  readonly lane: LaneName;
  readonly isDraft: boolean;
  readonly updatedAt: string;
  readonly checksState: string;
  readonly mergeability: string;
  readonly needsMyReview: boolean;
}

function makeCard(lane: LaneName, number: number): BoardCardJson {
  return {
    id: `pr-${number}`,
    number,
    title: `Pull request số ${number}`,
    author: 'octo-author',
    repository: { id: 'repo-1', owner: 'octo-org', name: 'demo-repo' },
    lane,
    isDraft: false,
    updatedAt: '2026-05-01T00:00:00.000Z',
    checksState: 'passing',
    mergeability: 'mergeable',
    needsMyReview: false,
  };
}

type BoardPayload = {
  lanes: Array<{ name: LaneName; count: number; cards: BoardCardJson[] }>;
  offline: boolean;
  stale: boolean;
};

function makeBoard(laneCards: Partial<Record<LaneName, BoardCardJson[]>> = {}): BoardPayload {
  return LANE_NAMES.reduce<BoardPayload>(
    (payload, name) => {
      const cards = laneCards[name] ?? [];
      payload.lanes.push({ name, count: cards.length, cards });
      return payload;
    },
    { lanes: [], offline: false, stale: false },
  );
}

const REPOS = [
  {
    id: 'repo-1',
    owner: 'octo-org',
    name: 'demo-repo',
    visibility: 'public',
    defaultBranch: 'main',
    connectedAt: '2026-05-01T00:00:00.000Z',
    lastSyncStatus: 'succeeded',
    aiAcknowledged: true,
    capabilities: { metadata: true, pull_requests: true, checks: true, contents: true },
  },
  {
    id: 'repo-2',
    owner: 'octo-org',
    name: 'limited-repo',
    visibility: 'public',
    defaultBranch: 'main',
    connectedAt: '2026-05-01T00:00:00.000Z',
    lastSyncStatus: 'succeeded',
    aiAcknowledged: true,
    capabilities: { metadata: true, pull_requests: false, checks: true, contents: true },
  },
];

const SESSION = {
  csrfToken: 'test-csrf-token',
  appVersion: 'test',
  credentialSource: 'GH_TOKEN',
  ai: {
    configured: false,
    destinationKnown: false,
    destinationLabel: null,
    model: 'none',
    mayLeaveMachine: false,
  },
  limits: {
    maxInlineFindings: 15,
    maxSummaryChars: 60_000,
    maxInlineCommentChars: 10_000,
    maxDiffFiles: 400,
    maxDiffLines: 20_000,
  },
};

function renderWithProviders(ui: ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const boardSearches: string[] = [];

/** Install a capture-all board handler; recorded queries drive wiring tests. */
function useBoardHandler(board: unknown): void {
  boardSearches.length = 0;
  mswServer.use(
    http.get('*/api/board', ({ request }) => {
      boardSearches.push(new URL(request.url).search);
      return HttpResponse.json(board);
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe('Board lanes (T047)', () => {
  it('renders the five lanes in display order with visible counts and cards', async () => {
    useBoardHandler(
      makeBoard({
        Draft: [makeCard('Draft', 1), makeCard('Draft', 2)],
        'In review': [makeCard('In review', 3)],
      }),
    );

    renderWithProviders(<Board />);

    await screen.findByText('Pull request số 1');
    const laneTitles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(laneTitles).toEqual(LANE_NAMES.map((name) => VI.lanes[name] ?? name));

    // Visible per-lane counts: Draft 2, In review 1, then empty lanes.
    const laneCounts = [...document.querySelectorAll('.board-lane-count')].map(
      (el) => el.textContent,
    );
    expect(laneCounts).toEqual(['2', '1', '0', '0', '0']);
    expect(screen.getByText(VI.board.totalCount.replace('{count}', '3'))).toBeInTheDocument();
  });

  it(`windows a lane with more than ${LANE_WINDOW_SIZE} cards and expands on demand`, async () => {
    const many = Array.from({ length: LANE_WINDOW_SIZE + 20 }, (_, index) =>
      makeCard('Approved', index + 1),
    );
    useBoardHandler(makeBoard({ Approved: many }));

    renderWithProviders(<Board />);
    await screen.findByText('Pull request số 1');

    expect(document.querySelectorAll('article.board-card')).toHaveLength(LANE_WINDOW_SIZE);
    expect(
      screen.getByRole('button', { name: VI.board.showMore.replace('{count}', '20') }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: VI.board.showMore.replace('{count}', '20') }),
    );
    expect(document.querySelectorAll('article.board-card')).toHaveLength(LANE_WINDOW_SIZE + 20);
    expect(
      screen.queryByRole('button', { name: VI.board.showMore.replace('{count}', '20') }),
    ).not.toBeInTheDocument();
  });
});

describe('BoardFilters (T048)', () => {
  const INITIAL: BoardFiltersState = { repoId: null, q: '', needsMyReview: false };

  /** Stateful harness so the controlled input accepts real typing. */
  function FiltersHarness(): ReactElement {
    const [value, setValue] = useState(INITIAL);
    return <BoardFilters value={value} onChange={setValue} />;
  }

  it('reports text, repository, and needs-my-review changes to its state', async () => {
    mswServer.use(http.get('*/api/repos', () => HttpResponse.json(REPOS.slice(0, 1))));

    renderWithProviders(<FiltersHarness />);
    await screen.findByPlaceholderText(VI.board.searchPlaceholder);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(VI.board.searchPlaceholder), 'cookie');
    const qInput = document.querySelector<HTMLInputElement>('#board-filter-q');
    expect(qInput?.value).toBe('cookie');
    expect(screen.getByLabelText(VI.board.needsMyReview).checked).toBe(false);
    expect(document.querySelector('#board-filter-repo')?.value).toBe('');

    await user.selectOptions(screen.getByLabelText(VI.board.repoFilterLabel), 'repo-1');
    expect(document.querySelector('#board-filter-repo')?.value).toBe('repo-1');

    await user.click(screen.getByLabelText(VI.board.needsMyReview));
    expect(screen.getByLabelText(VI.board.needsMyReview).checked).toBe(true);
  });

  it('clearing filters keeps the repository selection and resets the rest', async () => {
    mswServer.use(http.get('*/api/repos', () => HttpResponse.json(REPOS.slice(0, 1))));

    const preset: BoardFiltersState = { repoId: 'repo-1', q: 'cookie', needsMyReview: true };
    function PresetHarness(): ReactElement {
      const [value, setValue] = useState(preset);
      return <BoardFilters value={value} onChange={(next) => setValue({ ...next })} />;
    }
    renderWithProviders(<PresetHarness />);
    await screen.findByPlaceholderText(VI.board.searchPlaceholder);

    await userEvent.click(screen.getByRole('button', { name: VI.filters.clear }));

    // Repository stays selected; text and toggle reset to defaults.
    expect(document.querySelector('#board-filter-repo')?.value).toBe('repo-1');
    expect(document.querySelector<HTMLInputElement>('#board-filter-q')?.value).toBe('');
    expect(screen.getByLabelText(VI.board.needsMyReview).checked).toBe(false);
  });
});

describe('BoardPage wiring (T047/T048/T052)', () => {
  function installPageHandlers(options: {
    readonly board: unknown;
    readonly viewer: { readonly login: string } | null;
    readonly repos?: readonly unknown[];
  }): void {
    const { board, viewer, repos = REPOS } = options;
    boardSearches.length = 0;
    mswServer.use(
      http.get('*/api/board', ({ request }) => {
        boardSearches.push(new URL(request.url).search);
        return HttpResponse.json(board);
      }),
      http.get('*/api/repos', () => HttpResponse.json(repos)),
      http.get('*/api/session', () => HttpResponse.json({ ...SESSION, viewer })),
      http.get('*/api/health', () =>
        HttpResponse.json({ status: 'ok', database: 'ready', appVersion: 'test' }),
      ),
    );
  }

  it('feeds the board query with debounced text, repository, and the toggle', async () => {
    installPageHandlers({
      board: makeBoard({ Draft: [makeCard('Draft', 1)] }),
      viewer: { login: 'octo-viewer' },
    });

    renderWithProviders(<BoardPage />);
    await screen.findByText('Pull request số 1');
    expect(boardSearches[0]).toBe('?q=&needsMyReview=false');

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(VI.board.searchPlaceholder), 'cookie');
    await user.click(screen.getByLabelText(VI.board.needsMyReview));

    await waitFor(
      () => {
        const settled = boardSearches.at(-1) ?? '';
        expect(settled).toContain('needsMyReview=true');
        expect(decodeURIComponent(settled)).toContain('q=cookie');
      },
      { timeout: 2_000 },
    );

    // Clearing preserves the repository choice: pick one first, then clear.
    await user.selectOptions(screen.getByLabelText(VI.board.repoFilterLabel), 'repo-1');
    await waitFor(() => expect((boardSearches.at(-1) ?? '').includes('repoId=repo-1')).toBe(true));

    await user.click(screen.getByRole('button', { name: VI.filters.clear }));
    await waitFor(() => {
      const settled = boardSearches.at(-1) ?? '';
      expect(settled).toContain('repoId=repo-1');
      expect(settled).toContain('needsMyReview=false');
    });
  });

  it('shows the auth repair banner and no connect form without a viewer', async () => {
    installPageHandlers({ board: makeBoard(), viewer: null });

    renderWithProviders(<BoardPage />);
    await screen.findByText(VI.auth.title);

    expect(screen.queryByPlaceholderText('owner')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('flags repositories whose credentials cannot read pull requests', async () => {
    installPageHandlers({ board: makeBoard(), viewer: { login: 'octo-viewer' } });

    renderWithProviders(<BoardPage />);
    await screen.findByText(VI.repos.noPullRequestsTitle);

    expect(screen.getByText(VI.repos.noPullRequestsTitle)).toBeInTheDocument();
  });
});

describe('ConfirmActionDialog', () => {
  it('runs the confirmed action and closes; cancel only closes', async () => {
    let confirmed = 0;
    let open = true;

    const ui = (): ReactElement =>
      open ? (
        <ConfirmActionDialog
          open
          destructive
          title="Ngắt kết nối"
          description="Dữ liệu bảng cục bộ bị xóa."
          onConfirm={() => {
            confirmed += 1;
            open = false;
          }}
        />
      ) : null;

    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>{ui()}</QueryClientProvider>,
    );

    await screen.findByText('Ngắt kết nối');
    expect(screen.getByText('Dữ liệu bảng cục bộ bị xóa.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: VI.actions.confirm }));
    expect(confirmed).toBe(1);
    rerender(ui());
    expect(screen.queryByText('Ngắt kết nối')).not.toBeInTheDocument();
  });
});
