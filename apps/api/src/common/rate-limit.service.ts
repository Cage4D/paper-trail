/**
 * Fixed-window rate limits in Postgres, so every serverless instance shares them (bug-hunt
 * finding 5; also used by judge mode's /demo/start in Phase 6).
 */
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiError } from './api-error.js';

@Injectable()
export class RateLimitService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /** Count one hit for `key`; throw RATE_LIMITED past `limit` hits per `windowMs`. */
  async hit(key: string, limit: number, windowMs: number): Promise<void> {
    const rows = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, now(), 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowMs / 1000}) THEN 1 ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowMs / 1000}) THEN now() ELSE "RateLimit"."windowStart" END
      RETURNING "count"`;
    if ((rows[0]?.count ?? 0) > limit) throw new ApiError('RATE_LIMITED');
  }
}
