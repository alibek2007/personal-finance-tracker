import type { Category } from '@prisma/client';
import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from '@pfm/validation';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';
import { DEFAULT_CATEGORIES } from './default-categories';

export function toCategoryDto(c: Category): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId,
    icon: c.icon,
    color: c.color,
    isDefault: c.isDefault,
    isArchived: c.isArchived,
  };
}

/** Creates the starter tree. Idempotent: skips anything the user already has. */
export async function seedDefaultCategories(db: Db, userId: string): Promise<void> {
  if ((await db.category.count({ where: { userId } })) > 0) return;
  await db.$transaction(async (tx) => {
    for (const top of DEFAULT_CATEGORIES) {
      const parent = await tx.category.create({
        data: {
          userId,
          name: top.name,
          type: top.type,
          icon: top.icon,
          color: top.color,
          isDefault: true,
        },
      });
      for (const child of top.children ?? []) {
        await tx.category.create({
          data: {
            userId,
            parentId: parent.id,
            name: child.name,
            type: top.type,
            icon: child.icon,
            color: top.color,
            isDefault: true,
          },
        });
      }
    }
  });
}

export function createCategoriesService(db: Db) {
  async function findOwned(userId: string, id: string): Promise<Category> {
    const category = await db.category.findFirst({ where: { id, userId } });
    if (!category) throw AppError.notFound('That category');
    return category;
  }

  return {
    findOwned,

    async list(userId: string, includeArchived = false) {
      const rows = await db.category.findMany({
        where: { userId, ...(includeArchived ? {} : { isArchived: false }) },
        orderBy: [{ type: 'desc' }, { name: 'asc' }],
      });
      return rows.map(toCategoryDto);
    },

    async create(userId: string, input: CreateCategoryInput) {
      if (input.parentId) {
        const parent = await findOwned(userId, input.parentId);
        if (parent.parentId) {
          throw AppError.badRequest('Categories can only be nested one level deep.', 'too_deep');
        }
        if (parent.type !== input.type) {
          throw AppError.badRequest(
            'A subcategory must be the same kind (income or expense) as its parent.',
            'type_mismatch',
          );
        }
      }
      const duplicate = await db.category.findFirst({
        where: {
          userId,
          type: input.type,
          parentId: input.parentId ?? null,
          name: { equals: input.name, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw AppError.conflict(
          `You already have a category called "${input.name}" here.`,
          'category_exists',
        );
      }
      const created = await db.category.create({
        data: {
          userId,
          name: input.name,
          type: input.type,
          parentId: input.parentId ?? null,
          icon: input.icon,
          color: input.color,
        },
      });
      return toCategoryDto(created);
    },

    async update(userId: string, id: string, input: UpdateCategoryInput) {
      const existing = await findOwned(userId, id);
      if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await db.category.findFirst({
          where: {
            userId,
            type: existing.type,
            parentId: existing.parentId,
            id: { not: id },
            name: { equals: input.name, mode: 'insensitive' },
          },
        });
        if (duplicate) {
          throw AppError.conflict(
            `You already have a category called "${input.name}" here.`,
            'category_exists',
          );
        }
      }
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.category.update({ where: { id }, data: input });
        // Archiving a parent hides its subcategories too, so pickers never show orphans.
        if (input.isArchived !== undefined && !existing.parentId) {
          await tx.category.updateMany({
            where: { userId, parentId: id },
            data: { isArchived: input.isArchived },
          });
        }
        return row;
      });
      return toCategoryDto(updated);
    },

    /** Deleting a category that has history requires choosing where that history goes. */
    async remove(userId: string, id: string, reassignToId?: string) {
      const category = await findOwned(userId, id);
      const [children, transactions, budgets] = await Promise.all([
        db.category.count({ where: { userId, parentId: id } }),
        db.transaction.count({ where: { userId, categoryId: id } }),
        db.budget.count({ where: { userId, categoryId: id } }),
      ]);
      if (children > 0) {
        throw AppError.conflict(
          'This category has subcategories. Delete or move them first, or archive it instead.',
          'has_children',
        );
      }
      if (budgets > 0) {
        throw AppError.conflict(
          'A budget uses this category. Remove the budget first, or archive the category.',
          'has_budgets',
        );
      }
      if (transactions > 0) {
        if (!reassignToId) {
          throw AppError.conflict(
            `${transactions} transaction${transactions === 1 ? ' uses' : 's use'} this category. Choose where to move them, or archive the category instead.`,
            'has_transactions',
          );
        }
        const target = await findOwned(userId, reassignToId);
        if (target.type !== category.type || target.id === id) {
          throw AppError.badRequest(
            'Choose a different category of the same kind.',
            'bad_reassign',
          );
        }
        await db.$transaction([
          db.transaction.updateMany({
            where: { userId, categoryId: id },
            data: { categoryId: target.id },
          }),
          db.category.delete({ where: { id } }),
        ]);
        return;
      }
      await db.category.delete({ where: { id } });
    },
  };
}

export type CategoriesService = ReturnType<typeof createCategoriesService>;
