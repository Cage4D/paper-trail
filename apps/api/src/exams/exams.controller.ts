import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CreateExamBody, SetCentreBody } from '@paper-trail/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentSession, SessionGuard, type Session } from '../auth/session.js';
import { ExamsService } from './exams.service.js';

@Controller('exams')
export class ExamsController {
  constructor(@Inject(ExamsService) private readonly exams: ExamsService) {}

  @Post()
  @UseGuards(SessionGuard)
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateExamBody)) body: CreateExamBody) {
    return this.exams.create(s, body);
  }

  @Post(':id/centres')
  @UseGuards(SessionGuard)
  setCentre(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(SetCentreBody)) body: SetCentreBody) {
    return this.exams.setCentre(s, id, body);
  }

  @Get(':id')
  view(@Param('id') id: string) {
    return this.exams.view(id);
  }

  @Get(':id/committee')
  @UseGuards(SessionGuard)
  committee(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.exams.committee(s, id);
  }

  @Get(':id/centres/:cid/cipher')
  cipher(@Param('id') id: string, @Param('cid') cid: string) {
    return this.exams.cipher(id, cid);
  }
}
