import { registerAs } from '@nestjs/config';

// Configuration Booking Module - Plannings et réservations
export const bookingConfig = registerAs('booking', () => ({
  timeSlots: {
    slotDurationMinutes: parseInt(process.env.SLOT_DURATION_MINUTES) || 15,
    minBookAheadDays: parseInt(process.env.MIN_BOOK_AHEAD_DAYS) || 7,
    maxBookAheadDays: parseInt(process.env.MAX_BOOK_AHEAD_DAYS) || 90,
    peakHoursBlockout: process.env.PEAK_HOURS_BLOCKOUT === 'true',
  },
  // Types de bookings disponibles
  bookingTypes: {
    individual: {
      durationSlots: ['15min', '30min', '60min', '90min', '120min'],
      groupable: true,
      maxDurationMinutes: 180,
    },
    package: {
      durationSlots: ['single_session', '5_sessions', '10_sessions', '20_sessions'],
      groupable: false,
      maxDurationMinutes: 600,
    },
  },
}));
