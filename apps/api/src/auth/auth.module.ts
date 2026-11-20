import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BindingService } from './binding.service.js';

@Module({ controllers: [AuthController], providers: [AuthService, BindingService], exports: [AuthService] })
export class AuthModule {}
