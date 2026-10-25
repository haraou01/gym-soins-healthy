import { registerAs } from '@nestjs/config';

// Configuration Shop Module - Vente de produits et stocks

export const shopConfig = registerAs('shop', () => ({
  products: {
    stockLevels: {
      inStockThreshold: parseInt(process.env.STOCK_IN_THRESHOLD) || 5,
      lowStockAlert: parseInt(process.env.STOCK_LOW_ALERT) || 10,
      outOfStock: 0,
    },
    categories: [
      'equipment', 'apparel', 'supplements', 'accessories',
      'personal-care', 'fitness-tracker'
    ],
    inventoryValuations: {
      method: parseInt(process.env.INVENTORY_VALUATION_METHOD) || 'LIFO', // LIFO, FIFO, average, weighted
      currency: process.env.CURRENCY || 'EUR'
    }
  },
  
  // Stock management pour gestion des inventaires
  stock: {
    autoIncrementTracking: process.env.STOCK_AUTO_INCREMENT === 'true',
    realTimeUpdates: process.env.STOCK_REALTIME_UPDATES === 'true',
    multiWarehouseSupport: process.env.MULTI_WAREHOUSE_SUPPORT == 'true' || false,
  }
}));
