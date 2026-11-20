import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { ApiError } from '../common/api-error.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'pt_session';
export interface Session {
  userId: string;
  roleAddress: string; // qor1…
  evm: `0x${string}`; // lower-case
}

const key = () => new TextEncoder().encode(config().JWT_SECRET);

export async function issueSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.roleAddress, evm: s.evm }).setProtectedHeader({ alg: 'HS256' }).setSubject(s.userId).setIssuedAt().setExpirationTime('12h').sign(key());
}

export async function readSession(req: Request): Promise<Session | null> {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE] ?? bearer;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    return { userId: payload.sub!, roleAddress: payload.role as string, evm: payload.evm as `0x${string}` };
  } catch {
    return null;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { session?: Session }>();
    const s = await readSession(req);
    if (!s) throw new ApiError('UNAUTHENTICATED');
    req.session = s;
    return true;
  }
}

export const CurrentSession = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ session: Session }>().session);
