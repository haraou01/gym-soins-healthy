import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';

import type { LoginResponse, RegistrationDto, Role } from './index';
import { RBAC_PERMISSIONS } from './permissions';
import { RoleEntity } from './entities/role.entity';
import { User } from './entities/user.entity';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.findActiveUserByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    return this.buildLoginResponse(user);
  }

  async register(userData: RegistrationDto): Promise<LoginResponse> {
    const email = userData.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email } });

    if (existing) {
      throw new BadRequestException('Cet email est déjà utilisé');
    }

    const roleName: Role = userData.role ?? 'RECEPTIONIST';
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });

    if (!role) {
      throw new BadRequestException(`Rôle inconnu : ${roleName}`);
    }

    const user = await this.userRepository.save(
      this.userRepository.create({
        email,
        username: userData.username?.trim() || null,
        passwordHash: await bcrypt.hash(userData.password, BCRYPT_ROUNDS),
        role,
        isActive: true,
      }),
    );

    return this.buildLoginResponse(user);
  }

  async refreshToken(_refreshToken: string): Promise<LoginResponse> {
    throw new UnauthorizedException('Refresh token invalide');
  }

  /** --- Helpers --- */

  private async findActiveUserByEmail(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: { role: true },
    });

    if (!user || !user.isActive || !user.role) {
      return null;
    }

    return user;
  }

  private async buildLoginResponse(user: User): Promise<LoginResponse> {
    const role = user.role?.name as Role;
    const permissions = RBAC_PERMISSIONS[role] ?? [];

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role,
    });

    return {
      access_token: accessToken,
      role,
      permissions,
      user: { id: user.id, email: user.email },
    };
  }
}
