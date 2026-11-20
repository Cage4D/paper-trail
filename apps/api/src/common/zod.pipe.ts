import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ApiError } from './api-error.js';

export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new ApiError('VALIDATION_FAILED', { fields: r.error.issues.map((i) => i.path.join('.') || '(body)').join(', ') });
    return r.data;
  }
}
