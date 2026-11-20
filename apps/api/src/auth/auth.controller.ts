import { Body, Controller, Get, HttpCode, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { BindBody, RoleCardBody, SiwqChallengeBody, SiwqVerifyBody } from '@paper-trail/shared';
import type { SiwqSignature } from '@paper-trail/core';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { BindingService } from './binding.service.js';
import { CurrentSession, SESSION_COOKIE, SessionGuard, issueSession, type Session } from './session.js';
import { config } from '../config.js';

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(BindingService) private readonly binding: BindingService,
  ) {}

  @Post('me/bind/challenge')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  bindChallenge(@CurrentSession() s: Session) {
    return this.binding.challenge(s);
  }

  @Post('me/bind')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  bind(@CurrentSession() s: Session, @Body(new ZodPipe(BindBody)) b: BindBody) {
    return this.binding.bind(s, b);
  }

  @Post('auth/siwq/challenge')
  @HttpCode(200)
  challenge(@Body(new ZodPipe(SiwqChallengeBody)) body: { address: string }) {
    return this.auth.challenge(body.address).then(({ message }) => ({ message }));
  }

  @Post('auth/siwq/verify')
  @HttpCode(200)
  async verify(@Body(new ZodPipe(SiwqVerifyBody)) body: { message: string; signature: unknown }, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.verify(body.message, body.signature as SiwqSignature);
    const token = await issueSession(s);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config().NODE_ENV === 'production', maxAge: 12 * 3600_000, path: '/' });
    return { user: { roleAddress: s.roleAddress, evmAddress: s.evm }, token };
  }

  @Post('auth/logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Post('me/role')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  setRole(@CurrentSession() s: Session, @Body(new ZodPipe(RoleCardBody)) body: { sealCard: Record<string, unknown> }) {
    return this.auth.setCard(s, body.sealCard);
  }

  @Get('me/role/status')
  @UseGuards(SessionGuard)
  status(@CurrentSession() s: Session) {
    return this.auth.status(s);
  }

  @Get('directory')
  directory(@Query('role') role?: string) {
    return this.auth.directory(role);
  }
}
