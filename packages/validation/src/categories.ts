import { z } from 'zod';
import { CATEGORY_TYPES } from '@pfm/types';
import { hexColorSchema, idSchema } from './common';

export const categoryTypeSchema = z.enum(CATEGORY_TYPES);

const categoryName = z.string().trim().min(1, 'Give the category a name').max(40);

export const createCategorySchema = z.object({
  name: categoryName,
  type: categoryTypeSchema,
  /** Subcategories must have the same type as their parent. Only one level of nesting is supported. */
  parentId: idSchema.nullish(),
  icon: z.string().min(1).max(40).default('tag'),
  color: hexColorSchema.default('#5b6b84'),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: categoryName,
    icon: z.string().min(1).max(40),
    color: hexColorSchema,
    isArchived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  type: categoryTypeSchema,
  parentId: z.string().nullable(),
  icon: z.string(),
  color: z.string(),
  isDefault: z.boolean(),
  isArchived: z.boolean(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const categoryListSchema = z.object({ categories: z.array(categorySchema) });
