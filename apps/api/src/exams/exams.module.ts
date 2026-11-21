import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';
import { ReleaseService } from './release.service.js';

@Module({ controllers: [ExamsController], providers: [ExamsService, ReleaseService], exports: [ExamsService, ReleaseService] })
export class ExamsModule {}
