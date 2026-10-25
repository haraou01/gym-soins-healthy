import { registerAs } from '@nestjs/config';

// Configuration Care Module - Soins, thérapies, packs et unitaires
export const careConfig = registerAs('care', () => ({
  therapies: {
    defaultDurationMinutes: parseInt(process.env.DEFAULT_THERAPY_DURATION) || 60,
    minSessionPrice: parseFloat(process.env.CARE_PRICE_MIN) || 15,
    maxSessionPrice: parseFloat(process.env.CARE_PRICE_MAX) || 500,
  },
  // Packs soins avec sessions groupées et unitaires
  packs: {
    defaultSessions: parseInt(process.env.PACK_DEFAULT_SESSIONS) || 5,
    minPackPrice: parseFloat(process.env.PACK_MIN_PRICE) || 100,
  }
}));
