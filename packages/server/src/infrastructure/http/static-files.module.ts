import { Module } from '@nestjs/common';

import { StaticFilesController } from './static-files.controller.js';

@Module({ controllers: [StaticFilesController] })
export class StaticFilesModule {}
