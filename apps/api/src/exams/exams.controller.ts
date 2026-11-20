import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CreateExamBody, ReleaseBody, SetCentreBody } from '@paper-trail/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentSession, SessionGuard, type Session } from '../auth/session.js';
import { ExamsService } from './exams.service.js';
import { ReleaseService } from './release.service.js';

@Controller('exams')
export class ExamsController {
  constructor(
    @Inject(ExamsService) private readonly exams: ExamsService,
    @Inject(ReleaseService) private readonly rel: ReleaseService,
  ) {}

  @Get(':id/centres/:cid/my-share')
  @UseGuards(SessionGuard)
  myShare(@CurrentSession() s: Session, @Param('id') id: string, @Param('cid') cid: string) {
    return this.rel.myShare(s, id, cid);
  }

  @Get(':id/centres/:cid/invigilators')
  invigilators(@Param('id') id: string, @Param('cid') cid: string) {
    return this.rel.invigilators(id, cid);
  }

  @Post(':id/centres/:cid/release')
  @UseGuards(SessionGuard)
  release(@CurrentSession() s: Session, @Param('id') id: string, @Param('cid') cid: string, @Body(new ZodPipe(ReleaseBody)) b: ReleaseBody) {
    return this.rel.release(s, id, cid, b);
  }

  @Get(':id/centres/:cid/released')
  released(@Param('id') id: string, @Param('cid') cid: string) {
    return this.rel.released(id, cid);
  }

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
