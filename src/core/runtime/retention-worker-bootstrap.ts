import { configureRetentionWorkerEnvironment } from './worker-environment';

// Doit être évalué avant AppModule/ConfigModule.forRoot() : les variables
// d'environnement du worker de rétention doivent être posées avant la
// validation Joi et avant l'instanciation de KdsEventsService.
configureRetentionWorkerEnvironment();
