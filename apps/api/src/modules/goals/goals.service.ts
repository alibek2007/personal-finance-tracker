import type { GoalContribution, SavingsGoal } from '@prisma/client';
import {
  computeGoalState,
  describeGoal,
  formatMoney,
  isCurrencyCode,
  money,
  todayInZone,
  type CurrencyCode,
} from '@pfm/finance';
import type {
  ContributionInput,
  CreateGoalInput,
  GoalDetailDto,
  GoalDto,
  GoalListDto,
  UpdateGoalInput,
} from '@pfm/validation';
import { fromIsoDate, fromMinor, toIsoDate, toMinor } from '../../lib/convert';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';

const asCurrency = (c: string): CurrencyCode => (isCurrencyCode(c) ? c : 'USD');

export interface GoalDrift {
  goalId: string;
  name: string;
  stored: number;
  expected: number;
}

export function createGoalsService(db: Db, now: () => Date) {
  async function userContext(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    return {
      currency: asCurrency(user.currency),
      locale: user.locale,
      timezone: user.timezone,
      today: todayInZone(now(), user.timezone),
    };
  }

  async function findOwned(userId: string, id: string): Promise<SavingsGoal> {
    const goal = await db.savingsGoal.findFirst({ where: { id, userId } });
    if (!goal) throw AppError.notFound('That goal');
    return goal;
  }

  const validationError = (field: string, message: string) =>
    AppError.badRequest('Some fields need attention.', 'validation_failed', { [field]: [message] });

  /** Saving "started" the day the goal was created or the first contribution was dated, whichever is earlier. */
  function startedOn(
    goal: SavingsGoal,
    firstContribution: Date | null | undefined,
    ctx: { timezone: string },
  ): string {
    const created = todayInZone(goal.createdAt, ctx.timezone);
    const first = firstContribution ? toIsoDate(firstContribution) : null;
    return first && first < created ? first : created;
  }

  function toDto(
    goal: SavingsGoal,
    started: string,
    ctx: { today: string; locale: string },
  ): GoalDto {
    const currency = asCurrency(goal.currency);
    const deadline = goal.deadline ? toIsoDate(goal.deadline) : null;
    const state = computeGoalState({
      target: toMinor(goal.targetAmount),
      current: toMinor(goal.currentAmount),
      deadline,
      today: ctx.today,
      startedOn: started,
    });
    const text = describeGoal(state, deadline, ctx.today, (minor) =>
      formatMoney(money(Math.abs(minor), currency), {
        locale: ctx.locale,
        compactFraction: Math.abs(minor) % 100 === 0,
      }),
    );
    return {
      id: goal.id,
      name: goal.name,
      targetAmount: toMinor(goal.targetAmount),
      currentAmount: toMinor(goal.currentAmount),
      currency,
      deadline,
      color: goal.color,
      icon: goal.icon,
      isArchived: goal.isArchived,
      startedOn: started,
      progressBp: state.progressBp,
      remaining: state.remaining,
      surplus: state.surplus,
      reached: state.reached,
      daysLeft: state.daysLeft,
      monthsLeft: state.monthsLeft,
      requiredMonthly: state.requiredMonthly,
      expectedAmount: state.expectedAmount,
      scheduleDelta: state.scheduleDelta,
      status: state.status,
      headline: text.headline,
      detail: text.detail,
    };
  }

  const toContribution = (c: GoalContribution) => ({
    id: c.id,
    amount: toMinor(c.amount),
    date: toIsoDate(c.date),
    note: c.note,
    createdAt: c.createdAt.toISOString(),
  });

  async function dtoFor(
    userId: string,
    goal: SavingsGoal,
    ctx: Awaited<ReturnType<typeof userContext>>,
  ) {
    const first = await db.goalContribution.aggregate({
      where: { goalId: goal.id, userId },
      _min: { date: true },
    });
    return toDto(goal, startedOn(goal, first._min.date, ctx), ctx);
  }

  async function assertNameFree(userId: string, name: string, exceptId?: string) {
    const clash = await db.savingsGoal.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash)
      throw AppError.conflict(`You already have a goal called "${name}".`, 'goal_name_taken');
  }

  return {
    async list(userId: string, includeArchived = false): Promise<GoalListDto> {
      const ctx = await userContext(userId);
      const [goals, firsts] = await Promise.all([
        db.savingsGoal.findMany({
          where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
          orderBy: [{ isArchived: 'asc' }, { createdAt: 'asc' }],
        }),
        db.goalContribution.groupBy({ by: ['goalId'], where: { userId }, _min: { date: true } }),
      ]);
      const firstById = new Map(firsts.map((f) => [f.goalId, f._min.date]));
      const dtos = goals.map((g) => toDto(g, startedOn(g, firstById.get(g.id), ctx), ctx));
      const active = dtos.filter((g) => !g.isArchived && g.currency === ctx.currency);
      return {
        goals: dtos,
        summary:
          active.length > 0
            ? {
                currency: ctx.currency,
                saved: active.reduce((s, g) => s + g.currentAmount, 0),
                target: active.reduce((s, g) => s + g.targetAmount, 0),
                count: active.length,
              }
            : null,
      };
    },

    async get(userId: string, id: string): Promise<GoalDetailDto> {
      const ctx = await userContext(userId);
      const goal = await findOwned(userId, id);
      const contributions = await db.goalContribution.findMany({
        where: { goalId: id, userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      });
      return {
        ...(await dtoFor(userId, goal, ctx)),
        contributions: contributions.map(toContribution),
      };
    },

    async create(userId: string, input: CreateGoalInput): Promise<GoalDto> {
      const ctx = await userContext(userId);
      await assertNameFree(userId, input.name);
      if (input.deadline && input.deadline < ctx.today) {
        throw validationError('deadline', 'Choose a deadline that is today or later.');
      }
      const goal = await db.$transaction(async (tx) => {
        const created = await tx.savingsGoal.create({
          data: {
            userId,
            name: input.name,
            targetAmount: fromMinor(input.targetAmount),
            currentAmount: fromMinor(input.startingAmount ?? 0),
            currency: ctx.currency,
            deadline: input.deadline ? fromIsoDate(input.deadline) : null,
            color: input.color,
            icon: input.icon,
          },
        });
        if (input.startingAmount && input.startingAmount > 0) {
          await tx.goalContribution.create({
            data: {
              goalId: created.id,
              userId,
              amount: fromMinor(input.startingAmount),
              date: fromIsoDate(ctx.today),
              note: 'Starting amount',
            },
          });
        }
        return created;
      });
      return dtoFor(userId, goal, ctx);
    },

    async update(userId: string, id: string, input: UpdateGoalInput): Promise<GoalDto> {
      const ctx = await userContext(userId);
      const existing = await findOwned(userId, id);
      if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
        await assertNameFree(userId, input.name, id);
      }
      const existingDeadline = existing.deadline ? toIsoDate(existing.deadline) : null;
      if (input.deadline && input.deadline !== existingDeadline && input.deadline < ctx.today) {
        throw validationError('deadline', 'Choose a deadline that is today or later.');
      }
      const updated = await db.savingsGoal.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.targetAmount !== undefined
            ? { targetAmount: fromMinor(input.targetAmount) }
            : {}),
          ...(input.deadline !== undefined
            ? { deadline: input.deadline ? fromIsoDate(input.deadline) : null }
            : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        },
      });
      return dtoFor(userId, updated, ctx);
    },

    async remove(userId: string, id: string): Promise<void> {
      await findOwned(userId, id);
      await db.savingsGoal.delete({ where: { id } }); // contributions cascade
    },

    /** Deposits and withdrawals share one path: a signed amount applied atomically with the goal total. */
    async addContribution(userId: string, id: string, input: ContributionInput): Promise<GoalDto> {
      const ctx = await userContext(userId);
      const goal = await findOwned(userId, id);
      if (goal.isArchived)
        throw AppError.conflict('This goal is archived. Restore it to add to it.', 'goal_archived');
      const date = input.date ?? ctx.today;
      if (date > ctx.today)
        throw validationError(
          'date',
          "Contributions record money you've already put aside, so choose today or earlier.",
        );
      const fmt = (minor: number) =>
        formatMoney(money(minor, asCurrency(goal.currency)), { locale: ctx.locale });
      if (input.amount < 0 && -input.amount > toMinor(goal.currentAmount)) {
        throw validationError(
          'amount',
          `You can't take out more than is saved (${fmt(toMinor(goal.currentAmount))}).`,
        );
      }
      const updated = await db.$transaction(async (tx) => {
        await tx.goalContribution.create({
          data: {
            goalId: id,
            userId,
            amount: fromMinor(input.amount),
            date: fromIsoDate(date),
            note: input.note ?? null,
          },
        });
        return tx.savingsGoal.update({
          where: { id },
          data: { currentAmount: { increment: fromMinor(input.amount) } },
        });
      });
      return dtoFor(userId, updated, ctx);
    },

    async removeContribution(
      userId: string,
      goalId: string,
      contributionId: string,
    ): Promise<GoalDto> {
      const ctx = await userContext(userId);
      const goal = await findOwned(userId, goalId);
      const contribution = await db.goalContribution.findFirst({
        where: { id: contributionId, goalId, userId },
      });
      if (!contribution) throw AppError.notFound('That contribution');
      const amount = toMinor(contribution.amount);
      if (toMinor(goal.currentAmount) - amount < 0) {
        throw AppError.badRequest(
          'Removing this would leave a negative balance, because later withdrawals rely on it. Remove those first.',
          'would_go_negative',
        );
      }
      const updated = await db.$transaction(async (tx) => {
        await tx.goalContribution.delete({ where: { id: contributionId } });
        return tx.savingsGoal.update({
          where: { id: goalId },
          data: { currentAmount: { decrement: fromMinor(amount) } },
        });
      });
      return dtoFor(userId, updated, ctx);
    },

    /** Proves each stored total equals the sum of its contributions. */
    async reconcile(userId: string): Promise<GoalDrift[]> {
      const [goals, sums] = await Promise.all([
        db.savingsGoal.findMany({ where: { userId } }),
        db.goalContribution.groupBy({ by: ['goalId'], where: { userId }, _sum: { amount: true } }),
      ]);
      const sumById = new Map(sums.map((s) => [s.goalId, s._sum.amount ?? 0n]));
      const drift: GoalDrift[] = [];
      for (const g of goals) {
        const expected = toMinor(sumById.get(g.id) ?? 0n);
        const stored = toMinor(g.currentAmount);
        if (expected !== stored) drift.push({ goalId: g.id, name: g.name, stored, expected });
      }
      return drift;
    },
  };
}

export type GoalsService = ReturnType<typeof createGoalsService>;
