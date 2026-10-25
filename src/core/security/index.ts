// Security Module - Anti-distribution, licence et authentification JWT

export { SecurityModule } from './security.module';
export { LicenseModule } from './license.module';
export { LicenseService } from './license.service';
export { PermissionsGuard } from './permissions.guard';
export { RolesGuard } from './roles.guard';
export { Roles, ROLES_KEY } from './roles.decorator';
export { JwtAuthGuard } from './jwt-auth.guard';
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export type {
  LicensePayload,
  LicenseScope,
  ResolvedLicense,
  LICENSE_KEY_VERSION,
  LICENSE_SCOPE_ALL,
  LICENSED_FEATURES,
  LicensedFeature,
  isLicensePayload,
  isLicenseScope,
  isLicensedFeature,
} from './license.types';
