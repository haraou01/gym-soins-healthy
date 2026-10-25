import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthController } from './controllers/auth.controller';
import { AuthAuditService } from './auth-audit.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RoleEntity, SecurityAuditLog, User } from './entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RoleEntity, SecurityAuditLog]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwt = configService.get<{ secret: string; expiresIn: string }>('jwt');
        return {
          secret: jwt.secret,
          signOptions: { expiresIn: jwt.expiresIn || '1d' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthAuditService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
