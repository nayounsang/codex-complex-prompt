import { Module } from '@nestjs/common';

import { InputService } from './input.service.js';

@Module({ providers: [InputService], exports: [InputService] })
export class InputModule {}
