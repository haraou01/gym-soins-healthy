import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Delete,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { MaintenanceService } from '../services/maintenance.service';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  ReportIncidentDto,
  SchedulePreventiveDto,
  UpdateTicketDto,
  RecordEquipmentUsageDto,
} from '../dto/maintenance.dto';

@Controller('api/v1/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  /** --- Équipements --- */

  @Get('equipments')
  async findAllEquipment() {
    return this.maintenanceService.findAllEquipment();
  }

  @Get('equipments/:id')
  async getEquipment(@Param('id') id: string) {
    try {
      return await this.maintenanceService.findEquipmentById(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Équipement ${id} introuvable`);
    }
  }

  @Post('equipments')
  async createEquipment(@Body() dto: CreateEquipmentDto) {
    return this.maintenanceService.createEquipment(dto);
  }

  @Put('equipments/:id')
  async updateEquipment(
    @Param('id') id: string,
    @Body() dto: UpdateEquipmentDto,
  ) {
    try {
      return await this.maintenanceService.updateEquipment(id, dto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new NotFoundException(`Équipement ${id} introuvable`);
    }
  }

  @Delete('equipments/:id')
  async deleteEquipment(@Param('id') id: string) {
    try {
      return await this.maintenanceService.deleteEquipment(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Équipement ${id} introuvable`);
    }
  }

  /** Enregistre un cycle d'utilisation et déclenche la préventive si nécessaire. */
  @Post('equipments/:id/usage')
  async recordUsage(
    @Param('id') id: string,
    @Body() dto: RecordEquipmentUsageDto,
  ) {
    return this.maintenanceService.recordUsage(id, dto);
  }

  /** --- Tickets de maintenance / incidents --- */

  /** Génère les tickets préventifs arrivés à échéance. */
  @Post('preventive/run')
  async runPreventive() {
    return this.maintenanceService.generateDuePreventiveTickets();
  }

  @Get('tickets')
  async findAllTickets() {
    return this.maintenanceService.findAllTickets();
  }

  /** Planifie une maintenance préventive (ticket PREVENTIF). */
  @Post('tickets/preventive')
  async schedulePreventive(@Body() dto: SchedulePreventiveDto) {
    try {
      return await this.maintenanceService.schedulePreventiveMaintenance(dto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new BadRequestException(
        "Échec de la planification de la maintenance préventive",
      );
    }
  }

  /** Signale un incident : crée un ticket correctif et passe l'équipement en EN_PANNE. */
  @Post('tickets')
  async reportIncident(@Body() dto: ReportIncidentDto) {
    try {
      return await this.maintenanceService.reportIncident(dto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException("Échec du signalement d'incident");
    }
  }

  /** Résumé des coûts d'intervention (avant la route tickets/:id). */
  @Get('tickets/cost-summary')
  async getCostSummary() {
    return this.maintenanceService.getCostSummary();
  }

  @Get('tickets/equipment/:equipmentId')
  async getTicketsByEquipment(@Param('equipmentId') equipmentId: string) {
    return this.maintenanceService.findTicketsByEquipment(equipmentId);
  }

  @Get('tickets/:id')
  async getTicket(@Param('id') id: string) {
    try {
      return await this.maintenanceService.findTicketById(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }
  }

  /** Met à jour le suivi d'un ticket (technicien, pièces, coût, statut). */
  @Put('tickets/:id')
  async updateTicket(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    try {
      return await this.maintenanceService.updateTicket(id, dto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }
  }

  @Delete('tickets/:id')
  async deleteTicket(@Param('id') id: string) {
    try {
      return await this.maintenanceService.deleteTicket(id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }
  }
}
