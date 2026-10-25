import { registerAs } from '@nestjs/config';

// Configuration Loyalty Module - Programme de fidélité points/bonus/packs soins

export const loyaltyConfig = registerAs('loyalty', () => ({
  // Gestion des systèmes de points et récompenses pour programme de fidélité
  rewards: {
    pointsPerPurchase: parseInt(process.env.POINTS_PER_PURCHASE) || 10,
    minPointRedemption: parseInt(process.env.MIN_POINT_REDEMPTION) || 100,
    pointValue: parseFloat(process.env.POINT_VALUE) || 0.01, // € par point converti
    maxPointsPerMonth: parseInt(process.env.MAX_POINTS_PER_MONTH) || 5000,
  },
  
  // Packs soins avec récompenses intégrées pour programme de fidélité
  carePackages: {
    autoRewardIntegration: process.env.CARE_PACKAGE_REWARD == 'true' || false,
    minPackagePoints: parseInt(process.env.MIN_CARE_PACKAGE_POINTS) || 100,
  }
}));
