import { registerAs } from '@nestjs/config';

// Configuration Maintenance Module - Suivi et pannes des machines
export const maintenanceConfig = registerAs('maintenance', () => ({
  alerts: {
    criticalThresholdMinutes: parseInt(process.env.CRITICAL_THRESHOLD_MINUTES) || 24,
    warningThresholdMinutes: parseInt(process.env.WARNING_THRESHOLD_MINUTES) || 48,
    emailNotificationInterval: parseInt(process.env.ALERT_EMAIL_INTERVAL) || 60,
  },
  
  // Tracking des pannes et maintenance
  tracking: {
    autoCreateTicketOnCritical: process.env.AUTO_CREATE_TICKET === 'true',
    assignAutomatically: process.env.ASSIGN_AUTOMATICALLY === 'true',
  }
}));
