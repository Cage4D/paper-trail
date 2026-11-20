import { Module } from '@nestjs/common';
import { ScriptsController } from './scripts.controller.js';
import { ScriptsService } from './scripts.service.js';

@Module({ controllers: [ScriptsController], providers: [ScriptsService] })
export class ScriptsModule {}
