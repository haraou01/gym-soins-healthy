// src/core/security/license.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class LicenseService {
  // Simule la vérification d'une clé de licence et l'extraction des feature flags
  verifyLicenseKey(licenseKey: string, hardwareId: string): { isValid: boolean; modules: string[] } {
    if (!licenseKey || !hardwareId) {
      throw new UnauthorizedException('Clé de licence ou empreinte matérielle manquante.');
    }

    // Logique de validation cryptographique de la licence liée à l'empreinte machine (Hardware ID)
    // Dans un système de production, déchiffrement du JWT ou vérification de la signature
    const isSignatureValid = licenseKey.startsWith('VALID-KEY-');
    
    if (!isSignatureValid) {
      throw new UnauthorizedException('Licence invalide ou corrompue.');
    }

    // Exemple de modules activés encodés dans la licence (ex: VALID-KEY-GYM-CARE-SHOP)
    const activeModules = [];
    if (licenseKey.includes('GYM')) activeModules.push('gym');
    if (licenseKey.includes('CARE')) activeModules.push('care');
    if (licenseKey.includes('SHOP')) activeModules.push('shop');
    if (licenseKey.includes('HEALTHY')) activeModules.push('healthy_food');
    if (licenseKey.includes('MAINTENANCE')) activeModules.push('maintenance');
    if (licenseKey.includes('BOOKING')) activeModules.push('booking');
    if (licenseKey.includes('LOYALTY')) activeModules.push('loyalty');
    
    // Si la licence est de type "all-in-one"
    if (licenseKey.includes('ALL-IN-ONE')) {
      return {
        isValid: true,
        modules: ['gym', 'care', 'shop', 'healthy_food', 'maintenance', 'booking', 'loyalty', 'auth']
      };
    }

    return {
      isValid: true,
      modules: ['auth', ...activeModules]
    };
  }
}