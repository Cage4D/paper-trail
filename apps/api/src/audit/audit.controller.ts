import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';

@Controller('exams')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get(':id/audit')
  timeline(@Param('id') id: string) {
    return this.audit.audit(id);
  }

  @Get(':id/events')
  events(@Param('id') id: string, @Query('after') after?: string) {
    return this.audit.events(id, after);
  }
}
