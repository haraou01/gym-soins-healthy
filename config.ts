import 'dotenv/config';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

// Configuration globale de la base de données et Redis
export const typeormConfig = async (): Promise<TypeOrmModuleOptions> => {
  const configService = ConfigService;

  return {
    type: 'postgres',
    host: configService.get('POSTGRES_HOST') || 'localhost',
    port: configService.get('POSTGRES_PORT') || 5432,
    username: configService.get('POSTGRES_USERNAME') || 'admin',
    password: configService.get('POSTGRES_PASSWORD') || 'password',
    database: configService.get('POSTGRES_DATABASE') || 'gymsoins',
    autoLoadEntities: true,
    synchronize: false, // En production: false
    logging: configService.get('NODE_ENV') === 'development' ? 'verbose' : false,
  };
};

export default {
  typeorm: async (): Promise<TypeOrmModuleOptions> => {
    const configService = ConfigService;

    return {
      type: 'postgres',
      host: configService.get('POSTGRES_HOST') || 'localhost',
      port: configService.get('PORT') || 5432,
      username: configService.get('POSTGRES_USERNAME') || 'admin',
      password: configService.get('POSTGRES_PASSWORD') || 'password',
      database: configService.get('POSTGRES_DATABASE') || 'gymsoins',
      autoLoadEntities: true,
      synchronize: false, // En production: false
      logging: configService.get('NODE_ENV') === 'development' ? 'verbose' : false,
    };
  },
};
