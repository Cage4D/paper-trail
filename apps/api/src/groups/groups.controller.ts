import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RemoveMemberBody, RotateBody } from '@paper-trail/shared';
import { ZodPipe } from '../common/zod.pipe.js';
import { CurrentSession, SessionGuard, type Session } from '../auth/session.js';
import { GroupsService } from './groups.service.js';

@Controller()
export class GroupsController {
  constructor(@Inject(GroupsService) private readonly groups: GroupsService) {}

  @Post('groups/:groupKey/members')
  @UseGuards(SessionGuard)
  add(@CurrentSession() s: Session, @Param('groupKey') k: string, @Body(new ZodPipe(RotateBody)) b: RotateBody) {
    return this.groups.add(s, k, b);
  }

  @Delete('groups/:groupKey/members/:address')
  @UseGuards(SessionGuard)
  remove(@CurrentSession() s: Session, @Param('groupKey') k: string, @Param('address') a: string, @Body(new ZodPipe(RemoveMemberBody)) b: RemoveMemberBody) {
    return this.groups.remove(s, k, a, b);
  }

  @Get('groups/:groupKey/epochs')
  epochs(@Param('groupKey') k: string, @Query('board') board?: string, @Query('since') since?: string) {
    return this.groups.epochs(k, board, Number(since ?? 0) || 0);
  }

  @Get('board/state')
  @UseGuards(SessionGuard)
  state(@CurrentSession() s: Session) {
    return this.groups.boardState(s);
  }
}
