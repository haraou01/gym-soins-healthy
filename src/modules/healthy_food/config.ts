import { registerAs } from '@nestjs/config';

// Configuration Healthy Food Module - Cuisine, plats, KDS et décrémentation des stocks

export const healthyFoodConfig = registerAs('healthyFood', () => ({
  // Gestion de cuisine et préparation des plats sains
  kitchen: {
    maxConcurrentPlates: parseInt(process.env.MAX_CONCURRENT_PLATES) || 10,
    autoRecipeCreation: process.env.AUTO_RECIPE_CREATION == 'true' || false,
    prepTimeMinutes: parseInt(process.env.PREP_TIME_MINUTES) || 15
  },
  
  // KDS (Kitchen Display System) pour préparation rapide des commandes
  kds: {
    enableDisplayMode: process.env.ENABLE_KDS_DISPLAY == 'true' || true,
    showOrderStatus: true,
    notificationsEveryMinutes: parseInt(process.env.KDS_NOTIFICATION_INTERVAL) || 5,
    orderTimeoutMinutes: 30 // Auto-close orders après 30min non complété 
  },
}));
