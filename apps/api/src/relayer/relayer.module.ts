import { Global, Module } from '@nestjs/common';
import { RelayerService } from './relayer.service.js';

@Global()
@Module({ providers: [RelayerService], exports: [RelayerService] })
export class RelayerModule {}
