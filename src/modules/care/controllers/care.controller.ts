import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  NotFoundException,
} from '@nestjs/common';

import { CareService } from '../services/care.service';
import {
  AssignPackageDto,
  ConsumeSessionDto,
  CreateCareServiceDto,
} from '../dto/care.dto';

@Controller('api/v1/care')
export class CareController {
  constructor(private readonly careService: CareService) {}

  /** --- Catalogue des soins --- */

  @Get('services')
  async findAllCareServices() {
    return this.careService.findAllCareServices();
  }

  @Get('services/:id')
  async getCareService(@Param('id') id: string) {
    try {
      return await this.careService.findCareServiceById(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Soin ${id} introuvable`);
    }
  }

  @Post('services')
  async createCareService(@Body() dto: CreateCareServiceDto) {
    return this.careService.createCareService({
      title: dto.title,
      description: dto.description,
      durationMinutes: dto.durationMinutes,
      price: dto.price,
      type: dto.type,
    });
  }

  /** --- Attribution de packs --- */

  @Post('packages/assign')
  async assignPackage(@Body() dto: AssignPackageDto) {
    return this.careService.assignPackage(dto);
  }

  @Get('packages/client/:clientId')
  async getPackagesByClient(@Param('clientId') clientId: string) {
    return this.careService.findPackagesByClient(clientId);
  }

  /** --- Consommation d'une séance --- */

  @Post('sessions/consume')
  async consumeSession(@Body() dto: ConsumeSessionDto) {
    return this.careService.consumeSession(dto);
  }

  @Get('sessions/client/:clientId')
  async getSessionsByClient(@Param('clientId') clientId: string) {
    return this.careService.findSessionsByClient(clientId);
  }

  @Get('sessions/therapist/:therapistId')
  async getSessionsByTherapist(@Param('therapistId') therapistId: string) {
    return this.careService.findSessionsByTherapist(therapistId);
  }
}
