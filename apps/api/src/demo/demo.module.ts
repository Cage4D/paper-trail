import { Module } from '@nestjs/common';
import { ExamsModule } from '../exams/exams.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

@Module({ imports: [ExamsModule, ScriptsModule], controllers: [DemoController], providers: [DemoService] })
export class DemoModule {}
