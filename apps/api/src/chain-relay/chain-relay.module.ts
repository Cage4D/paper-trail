import { Module } from '@nestjs/common';
import { ChainRelayController } from './chain-relay.controller.js';

@Module({ controllers: [ChainRelayController] })
export class ChainRelayModule {}
