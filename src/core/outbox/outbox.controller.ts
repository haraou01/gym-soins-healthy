import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../security';
import { RolesGuard } from '../security';
import { OutboxService } from './outbox.service';

@Controller('api/v1/outbox')
@UseGuards(RolesGuard)
@Roles('SUPER_ADMIN')
export class OutboxController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get('stats')
  async getStats() {
    return this.outboxService.getStats();
  }

  @Get('failed')
  async findFailed() {
    return this.outboxService.findFailed();
  }

  @Post(':id/retry')
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const event = await this.outboxService.requeueFailed(id);

    if (!event) {
      throw new NotFoundException(
        `Événement outbox ${id} introuvable ou non FAILED`,
      );
    }

    return event;
  }
}
