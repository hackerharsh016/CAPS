import { z } from 'zod';
import { isValidPageRange } from './helpers.js';

export const PaperSizeSchema = z.enum(['A4', 'A3', 'Legal'], {
  errorMap: () => ({ message: "Paper size must be one of 'A4', 'A3', or 'Legal'" })
});

export const ColorModeSchema = z.enum(['bw', 'color'], {
  errorMap: () => ({ message: "Color mode must be either 'bw' or 'color'" })
});

export const SideModeSchema = z.enum(['single', 'double'], {
  errorMap: () => ({ message: "Sides mode must be either 'single' or 'double'" })
});

export const OrientationSchema = z.enum(['portrait', 'landscape'], {
  errorMap: () => ({ message: "Orientation must be either 'portrait' or 'landscape'" })
});

export const BindingTypeSchema = z.enum(['none', 'spiral', 'staple', 'lamination'], {
  errorMap: () => ({ message: "Binding must be 'none', 'spiral', 'staple', or 'lamination'" })
});

export const PrintSettingsSchema = z
  .object({
    paper_size: PaperSizeSchema,
    color_mode: ColorModeSchema,
    sides: SideModeSchema,
    orientation: OrientationSchema,
    copies: z
      .number({
        required_error: 'Copies count is required',
        invalid_type_error: 'Copies must be an integer'
      })
      .int('Copies must be an integer')
      .min(1, 'Copies must be at least 1')
      .max(100, 'Copies cannot exceed 100'),
    page_range: z
      .string({ required_error: 'Page range is required' })
      .min(1, 'Page range cannot be empty')
      .refine(isValidPageRange, {
        message: 'Invalid page range format. Must be "all" or expressions like "1-5, 8"'
      }),
    binding: BindingTypeSchema
  })
  .strict('Unrecognized properties are forbidden in PrintSettings');

export type ValidatedPrintSettings = z.infer<typeof PrintSettingsSchema>;
