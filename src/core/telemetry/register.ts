/**
 * Effet de bord volontaire : démarre OTel avant les imports Nest/http/pg.
 * Importer ce fichier en premier dans main.ts, worker.ts et retention-worker.ts.
 */
import { startTelemetry } from './telemetry';

startTelemetry();
