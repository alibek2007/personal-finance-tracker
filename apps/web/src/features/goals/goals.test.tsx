import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalDto } from '@pfm/validation';
import { ledgerHandlers } from '../../test/fixtures';
import { emptyOverview, mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

const goal = (over: Partial<GoalDto> & { id: string; name: string }): GoalDto => ({
  targetAmount: 200000,
  currentAmount: 120000,
  currency: 'USD',
  deadline: '2027-03-31',
  color: '#1f4e5a',
  icon: 'target',
  isArchived: false,
  startedOn: '2026-06-01',
  progressBp: 6000,
  remaining: 80000,
  surplus: 0,
  reached: false,
  daysLeft: 167,
  monthsLeft: 6,
  requiredMonthly: 13334,
  expectedAmount: 100000,
  scheduleDelta: 20000,
  status: 'ahead',
  headline: '$133.34/month to reach your goal by March 2027',
  detail: "You're $200 ahead of schedule.",
  ...over,
});

const laptop = goal({ id: 'laptop', name: 'Laptop' });
const vacation = goal({
  id: 'vac',
  name: 'Vacation',
  targetAmount: 240000,
  currentAmount: 85000,
  progressBp: 3542,
  remaining: 155000,
  deadline: '2026-12-20',
  status: 'behind',
  scheduleDelta: -30000,
  requiredMonthly: 77500,
  headline: '$775/month to reach your goal by December',
  detail: "You're $300 behind schedule.",
});
const done = goal({
  id: 'done',
  name: 'Bike',
  targetAmount: 50000,
  currentAmount: 50000,
  progressBp: 10000,
  remaining: 0,
  reached: true,
  status: 'reached',
  headline: 'Goal reached',
  detail: null,
  requiredMonthly: null,
});
const archived = goal({ id: 'old', name: 'Old plan', isArchived: true });

const withGoals = (goals: GoalDto[], extra: Record<string, unknown> = {}) => ({
  ...ledgerHandlers(),
  'GET /goals': () => {
    const active = goals.filter((g) => !g.isArchived);
    return {
      json: {
        goals,
        summary: active.length
          ? {
              currency: 'USD',
              saved: active.reduce((s, g) => s + g.currentAmount, 0),
              target: active.reduce((s, g) => s + g.targetAmount, 0),
              count: active.length,
            }
          : null,
      },
    };
  },
  ...extra,
});

describe('goals page', () => {
  it('shows each goal with its monthly amount, schedule and target date', async () => {
    mockApi(withGoals([laptop, vacation]));
    renderApp('/goals');
    const row = await screen.findByRole('button', { name: 'Open Laptop goal' });
    expect(within(row).getByText('$1,200 of $2,000')).toBeInTheDocument();
    expect(
      within(row).getByText(/\$133\.34\/month to reach your goal by March 2027/),
    ).toBeInTheDocument();
    expect(within(row).getByText("You're $200 ahead of schedule.")).toBeInTheDocument();
    expect(within(row).getByText('60%')).toBeInTheDocument();
    expect(within(row).getByText(/Target date Mar 31, 2027/)).toBeInTheDocument();
    expect(
      within(row).getByRole('progressbar', { name: 'Laptop goal, 60% saved' }),
    ).toBeInTheDocument();

    const behind = screen.getByRole('button', { name: 'Open Vacation goal' });
    expect(within(behind).getByText("You're $300 behind schedule.")).toBeInTheDocument();
    expect(within(behind).getByText(/^!/)).toBeInTheDocument(); // a marker, not just a colour
  });

  it('celebrates a reached goal in words', async () => {
    mockApi(withGoals([done]));
    renderApp('/goals');
    const row = await screen.findByRole('button', { name: 'Open Bike goal' });
    expect(within(row).getByText(/✓ Goal reached/)).toBeInTheDocument();
  });

  it('summarises the active goals and tucks archived ones away', async () => {
    const user = userEvent.setup();
    mockApi(withGoals([laptop, vacation, archived]));
    renderApp('/goals');
    const summary = await screen.findByRole('region', { name: 'Savings summary' });
    expect(within(summary).getByText('Saved toward 2 goals')).toBeInTheDocument();
    expect(within(summary).getByText('$2,050')).toBeInTheDocument();
    expect(screen.queryByText('Old plan')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show 1 archived goal/ }));
    expect(screen.getByRole('button', { name: 'Open Old plan goal' })).toBeInTheDocument();
  });

  it('welcomes a user with no goals', async () => {
    mockApi(withGoals([]));
    renderApp('/goals');
    expect(await screen.findByText("You haven't set a savings goal yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create your first goal/ })).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...withGoals([laptop]),
      'GET /goals': () =>
        up ? { json: { goals: [laptop], summary: null } } : { status: 500, json: {} },
    });
    renderApp('/goals');
    expect(await screen.findByText("Couldn't load your goals")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Open Laptop goal' })).toBeInTheDocument();
  });
});

describe('creating and editing', () => {
  it('creates a goal with no deadline (an empty date must not be an error)', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withGoals([]),
      'POST /goals': (body) => ({
        status: 201,
        json: goal({ id: 'n', name: (body as { name: string }).name }),
      }),
    });
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: /Create your first goal/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Create a goal' });
    await user.type(within(dialog).getByLabelText('What are you saving for?'), 'Emergency fund');
    await user.type(within(dialog).getByLabelText('Target amount'), '5,000');
    await user.click(within(dialog).getByRole('button', { name: 'Create goal' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/goals')).toBe(true),
    );
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Emergency fund',
      targetAmount: 500000,
      deadline: null,
    });
    expect(await screen.findByText('Emergency fund created')).toBeInTheDocument();
  });

  it('creates a goal with a deadline and a starting amount in exact minor units', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withGoals([]),
      'POST /goals': () => ({ status: 201, json: laptop }),
    });
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: /Create your first goal/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What are you saving for?'), 'Laptop');
    await user.type(within(dialog).getByLabelText('Target amount'), '2000');
    await user.type(within(dialog).getByLabelText('Deadline (optional)'), '2027-03-31');
    await user.type(within(dialog).getByLabelText('Already saved (optional)'), '500.50');
    await user.click(within(dialog).getByRole('button', { name: 'Create goal' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Laptop',
      targetAmount: 200000,
      deadline: '2027-03-31',
      startingAmount: 50050,
    });
  });

  it('asks for a name and a target in plain language', async () => {
    const user = userEvent.setup();
    const calls = mockApi(withGoals([]));
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: /Create your first goal/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create goal' }));
    expect(await within(dialog).findByText('Give your goal a name')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the server’s explanation for a past deadline next to the field', async () => {
    const user = userEvent.setup();
    mockApi({
      ...withGoals([]),
      'POST /goals': () => ({
        status: 400,
        json: {
          error: {
            code: 'validation_failed',
            message: 'Some fields need attention.',
            details: { deadline: ['Choose a deadline that is today or later.'] },
          },
        },
      }),
    });
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: /Create your first goal/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What are you saving for?'), 'Trip');
    await user.type(within(dialog).getByLabelText('Target amount'), '100');
    await user.type(within(dialog).getByLabelText('Deadline (optional)'), '2020-01-01');
    await user.click(within(dialog).getByRole('button', { name: 'Create goal' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Deadline (optional)')).toHaveAccessibleDescription(
        /today or later/,
      ),
    );
  });
});

describe('goal drawer', () => {
  const detail = (g: GoalDto) => ({
    'GET /goals/laptop': () => ({
      json: {
        ...g,
        contributions: [
          {
            id: 'c2',
            amount: -5000,
            date: '2026-10-01',
            note: 'Repair',
            createdAt: '2026-10-01T10:00:00Z',
          },
          {
            id: 'c1',
            amount: 30000,
            date: '2026-09-01',
            note: 'Monthly saving',
            createdAt: '2026-09-01T10:00:00Z',
          },
        ],
      },
    }),
  });

  async function openLaptop(handlers: Record<string, unknown> = {}) {
    const user = userEvent.setup();
    const calls = mockApi({ ...withGoals([laptop]), ...detail(laptop), ...handlers } as never);
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: 'Open Laptop goal' }));
    const drawer = await screen.findByRole('dialog', { name: 'Laptop' });
    return { user, calls, drawer };
  }

  it('shows the history with signed amounts', async () => {
    const { drawer } = await openLaptop();
    const history = await within(drawer).findByRole('region', { name: 'History' });
    expect(await within(history).findByText('Monthly saving')).toBeInTheDocument();
    expect(within(history).getByText('+$300.00')).toBeInTheDocument();
    expect(within(history).getByText('−$50.00')).toBeInTheDocument();
  });

  it('adds money in exact minor units', async () => {
    const { user, calls, drawer } = await openLaptop({
      'POST /goals/laptop/contributions': () => ({ status: 201, json: laptop }),
    });
    await user.type(within(drawer).getByLabelText('Amount'), '75.25');
    await user.type(within(drawer).getByLabelText('Note (optional)'), 'Bonus');
    await user.click(within(drawer).getByRole('button', { name: 'Add to goal' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/contributions'))).toBe(
        true,
      ),
    );
    expect(calls.find((c) => c.path.endsWith('/contributions'))!.body).toMatchObject({
      amount: 7525,
      note: 'Bonus',
    });
    expect(await screen.findByText('Added to your goal')).toBeInTheDocument();
  });

  it('taking money out sends a negative amount and surfaces the server’s limit message', async () => {
    const { user, calls, drawer } = await openLaptop({
      'POST /goals/laptop/contributions': () => ({
        status: 400,
        json: {
          error: {
            code: 'validation_failed',
            message: 'x',
            details: { amount: ["You can't take out more than is saved ($1,200.00)."] },
          },
        },
      }),
    });
    await user.click(within(drawer).getByRole('radio', { name: 'Take out' }));
    await user.type(within(drawer).getByLabelText('Amount'), '5000');
    await user.click(within(drawer).getByRole('button', { name: 'Take out' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/contributions'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/contributions'))!.body).toMatchObject({
      amount: -500000,
    });
    await waitFor(() =>
      expect(within(drawer).getByLabelText('Amount')).toHaveAccessibleDescription(
        /can't take out more/,
      ),
    );
  });

  it('will not post a zero or empty amount', async () => {
    const { user, calls, drawer } = await openLaptop();
    await user.click(within(drawer).getByRole('button', { name: 'Add to goal' }));
    expect(
      await within(drawer).findByText('Enter an amount greater than zero'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/contributions'))).toBe(false);
  });

  it('removes a history entry', async () => {
    const { user, calls, drawer } = await openLaptop({
      'DELETE /goals/laptop/contributions/c1': () => ({ json: laptop }),
    });
    await user.click(
      await within(drawer).findByRole('button', { name: /Remove the deposit on Sep 1/ }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('Entry removed')).toBeInTheDocument();
  });

  it('archives, which also stops further additions', async () => {
    const { user, calls, drawer } = await openLaptop({
      'PATCH /goals/laptop': (body: unknown) => ({ json: { ...laptop, ...(body as object) } }),
    });
    await user.click(within(drawer).getByRole('button', { name: /Archive/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ isArchived: true });
  });

  it('an archived goal offers restore instead of the add-money form', async () => {
    const user = userEvent.setup();
    mockApi({
      ...withGoals([archived]),
      'GET /goals/old': () => ({ json: { ...archived, contributions: [] } }),
    });
    renderApp('/goals');
    await user.click(await screen.findByRole('button', { name: /Show 1 archived goal/ }));
    await user.click(screen.getByRole('button', { name: 'Open Old plan goal' }));
    const drawer = await screen.findByRole('dialog', { name: 'Old plan' });
    expect(within(drawer).getByRole('button', { name: /Restore/ })).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Add to goal' })).not.toBeInTheDocument();
  });

  it('deleting needs confirmation', async () => {
    const { user, calls, drawer } = await openLaptop({
      'DELETE /goals/laptop': () => ({ json: { ok: true } }),
    });
    await user.click(within(drawer).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete Laptop?' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Delete goal' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('Goal deleted')).toBeInTheDocument();
  });
});

describe('dashboard goals', () => {
  const overview = { ...emptyOverview, hasTransactions: true, totalBalance: 100000 };
  const dash = (goals: GoalDto[]) => ({
    ...withGoals(goals),
    'GET /analytics/overview': () => ({ json: overview }),
    'GET /analytics/cash-flow': () => ({
      json: {
        currency: 'USD',
        from: '2026-09-16',
        to: '2026-10-15',
        unit: 'week',
        points: [],
        totals: { income: 0, spent: 0, saved: 0, savingsRateBp: null },
        excludedCurrencies: [],
      },
    }),
    'GET /analytics/categories': () => ({
      json: {
        currency: 'USD',
        from: '2026-10-01',
        to: '2026-10-15',
        total: 0,
        slices: [],
        excludedCurrencies: [],
      },
    }),
  });

  it('shows goals that are behind first and skips finished ones', async () => {
    mockApi(dash([laptop, done, vacation]));
    renderApp('/');
    const section = (await screen.findByRole('heading', { name: 'Savings goals' })).closest(
      'section',
    )!;
    await within(section).findByText('Vacation');
    const bars = within(section).getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAccessibleName(/Vacation goal/); // behind schedule first
    expect(bars[1]).toHaveAccessibleName(/Laptop goal/);
    expect(within(section).queryByText('Bike')).not.toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Manage goals' })).toHaveAttribute(
      'href',
      '/goals',
    );
  });

  it('nudges the user to create a first goal', async () => {
    mockApi(dash([]));
    renderApp('/');
    expect(await screen.findByText(/Saving for something\?/)).toBeInTheDocument();
  });
});
