import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { MarkBody, PublishMarksBody, ScriptBody, SubmitScriptsBody } from '@paper-trail/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentSession, SessionGuard, type Session } from '../auth/session.js';
import { ScriptsService } from './scripts.service.js';

@Controller()
export class ScriptsController {
  constructor(@Inject(ScriptsService) private readonly scripts: ScriptsService) {}

  @Post('exams/:id/scripts')
  submit(@Param('id') id: string, @Body(new ZodPipe(ScriptBody)) b: ScriptBody) {
    return this.scripts.submit(id, b);
  }

  @Get('exams/:id/markers')
  markers(@Param('id') id: string) {
    return this.scripts.markers(id);
  }

  @Get('exams/:id/scripts/pending')
  @UseGuards(SessionGuard)
  pending(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.scripts.pending(s, id);
  }

  @Post('exams/:id/scripts/submit')
  @UseGuards(SessionGuard)
  relay(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(SubmitScriptsBody)) b: SubmitScriptsBody) {
    return this.scripts.relayBatch(s, id, b);
  }

  @Get('exams/:id/scripts')
  @UseGuards(SessionGuard)
  queue(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.scripts.queue(s, id);
  }

  @Post('scripts/:id/marks')
  @UseGuards(SessionGuard)
  mark(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(MarkBody)) b: MarkBody) {
    return this.scripts.mark(s, id, b);
  }

  @Get('exams/:id/marks')
  @UseGuards(SessionGuard)
  entries(@CurrentSession() s: Session, @Param('id') id: string) {
    return this.scripts.markEntries(s, id);
  }

  @Post('exams/:id/marks/publish')
  @UseGuards(SessionGuard)
  publish(@CurrentSession() s: Session, @Param('id') id: string, @Body(new ZodPipe(PublishMarksBody)) b: PublishMarksBody) {
    return this.scripts.publish(s, id, b);
  }

  @Get('exams/:id/marks/proof')
  proof(@Param('id') id: string, @Query('pseudonym') pseudonym: string) {
    return this.scripts.proof(id, pseudonym ?? '');
  }
}
