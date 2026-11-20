import { Global, Module } from '@nestjs/common';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { MemberKeysService } from './members.js';

@Global()
@Module({ controllers: [GroupsController], providers: [GroupsService, MemberKeysService], exports: [MemberKeysService, GroupsService] })
export class GroupsModule {}
