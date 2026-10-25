import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque une route (ou un contrôleur entier) comme accessible sans JWT.
 *
 * À réserver aux endpoints réellement publics : connexion, inscription,
 * licence et éventuels diagnostics.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
