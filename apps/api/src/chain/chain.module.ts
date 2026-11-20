import { Global, Module } from '@nestjs/common';
import { ChainService } from './chain.service.js';
import { IndexerService } from './indexer.service.js';

@Global()
@Module({ providers: [ChainService, IndexerService], exports: [ChainService, IndexerService] })
export class ChainModule {}
