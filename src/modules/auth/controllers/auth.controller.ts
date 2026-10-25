import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { LoginDto, RegisterDto } from '../dtos';
import { AuthRequestContext, AuthService } from '../auth.service';
import { Public } from '../../../core/security/public.decorator';

@Public()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(
      dto.email,
      dto.password,
      this.requestContext(request),
    );
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, this.requestContext(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  refresh(@Body('refreshToken') refreshToken: string, @Req() request: Request) {
    return this.authService.refreshToken(
      refreshToken,
      this.requestContext(request),
    );
  }

  private requestContext(request: Request): AuthRequestContext {
    const header = request.headers['user-agent'];

    return {
      ip: request.ip,
      userAgent: Array.isArray(header) ? header.join(' ') : header,
    };
  }
}
