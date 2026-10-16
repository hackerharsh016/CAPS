/**
 * User-side print configuration domain types for CAPS.
 */

export type PaperSize = 'A4' | 'A3' | 'Legal';

export type ColorMode = 'bw' | 'color';

export type SideMode = 'single' | 'double';

export type Orientation = 'portrait' | 'landscape';

export type BindingType = 'none' | 'spiral' | 'staple' | 'lamination';

export interface PrintSettings {
  /** Paper dimensions target */
  paper_size: PaperSize;
  /** Color reproduction mode */
  color_mode: ColorMode;
  /** Single or double-sided printing */
  sides: SideMode;
  /** Page orientation */
  orientation: Orientation;
  /** Copy count between 1 and 100 inclusive */
  copies: number;
  /** Page range specification: 'all' or comma/dash separated numbers, e.g. '1-5, 8' */
  page_range: string;
  /** Finishing service request */
  binding: BindingType;
}
