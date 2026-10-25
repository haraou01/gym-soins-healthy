import { configureOutboxWorkerEnvironment } from './worker-environment';

// Doit être évalué avant AppModule/ConfigModule.forRoot() : les variables
// d'environnement des workers doivent être posées avant la validation Joi.
configureOutboxWorkerEnvironment();
