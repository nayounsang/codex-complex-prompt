import { Module } from '@nestjs/common';

import { StaticFilesController } from './static-files.controller.js';
import { StaticFilesService } from './static-files.service.js';

@Module({ controllers: [StaticFilesController], providers: [StaticFilesService] })
export class StaticFilesModule {}
