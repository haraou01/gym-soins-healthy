import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL renvoie les colonnes NUMERIC sous forme de chaînes.
 * Ce transformer garantit des `number` JS côté entité et côté API.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null): number | null =>
    value === null || value === undefined ? null : Number(value),

  from: (value?: string | number | null): number | null => {
    if (value === null || value === undefined) {
      return null;
    }

    return typeof value === 'number' ? value : parseFloat(value);
  },
};
