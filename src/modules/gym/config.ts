import { registerAs } from '@nestjs/config';

// Configuration Gym Module - Abonnements, accès et gestion individu/groupes
export const gymConfig = registerAs('gym', () => ({
  subscriptions: {
    billingInterval: process.env.BILLING_INTERVAL || 'monthly', // monthly|weekly|yearly
    trialPeriodDays: parseInt(process.env.TRIAL_PERIOD_DAYS) || 7,
    defaultSubscriptionIds: ['basic', 'standard', 'premium'],
    subscriptionIdFormats: {
      basic: 'G{id}-BASIC',
      standard: 'G{id}-STANDARD', 
      premium: 'G{id}-PREMIUM',
    }
  },
  // Accès gym pour individus et groupes
  access: {
    maxCapacity: parseInt(process.env.GYM_MAX_CAPACITY) || 500,
    peakHourBookingLimit: parseInt(process.env.PEAK_HOUR_BOOKING_LIMIT) || 120,
    timeSlotsPerDay: parseInt(process.env.TIME_SLOTS_PER_DAY) || 16,
  },
  groups: {
    maxMembers: parseInt(process.env.GROUP_MAX_MEMBERS) || 30,
    groupTypes: ['corporate', 'team', 'social', 'personal'],
  }
}));
