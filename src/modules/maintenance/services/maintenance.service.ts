import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';

import { Equipment, EquipmentStatus } from '../entities/equipment.entity';
import {
  MaintenanceTicket,
  MaintenancePriority,
  MaintenanceTicketStatus,
  MaintenanceTicketType,
} from '../entities/maintenance-ticket.entity';
import {
  CreateEquipmentDto,
  UpdateEquipmentDto,
  ReportIncidentDto,
  SchedulePreventiveDto,
  UpdateTicketDto,
  RecordEquipmentUsageDto,
} from '../dto/maintenance.dto';

export interface TicketCostSummary {
  totalTickets: number;
  totalCost: number;
  resolvedTickets: number;
  openTickets: number;
}

export interface RecordUsageResult {
  equipment: Equipment;
  preventiveTicket?: MaintenanceTicket;
}

export interface PreventiveRunResult {
  createdTickets: MaintenanceTicket[];
}

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(Equipment)
    private readonly equipmentRepository: Repository<Equipment>,
    @InjectRepository(MaintenanceTicket)
    private readonly maintenanceTicketRepository: Repository<MaintenanceTicket>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** --- Inventaire des équipements --- */

  async findAllEquipment(): Promise<Equipment[]> {
    return this.equipmentRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findEquipmentById(id: string): Promise<Equipment> {
    const equipment = await this.equipmentRepository.findOne({ where: { id } });

    if (!equipment) {
      throw new NotFoundException(`Équipement ${id} introuvable`);
    }

    return equipment;
  }

  async findEquipmentBySerial(serialNumber: string): Promise<Equipment | null> {
    return this.equipmentRepository.findOne({ where: { serialNumber } });
  }

  async createEquipment(dto: CreateEquipmentDto): Promise<Equipment> {
    const existing = await this.findEquipmentBySerial(dto.serialNumber);

    if (existing) {
      throw new BadRequestException(
        `Un équipement avec le numéro de série ${dto.serialNumber} existe déjà`,
      );
    }

    const usageCount = dto.usageCount ?? 0;
    const runningHours = dto.runningHours ?? 0;
    const now = new Date();

    const equipment = this.equipmentRepository.create({
      ...dto,
      name: dto.name.trim(),
      serialNumber: dto.serialNumber.trim(),
      location: dto.location.trim(),
      supplier: dto.supplier?.trim() || undefined,
      status: EquipmentStatus.ACTIF,
      usageCount,
      runningHours,
      usageAtLastPreventive: usageCount,
      runningHoursAtLastPreventive: runningHours,
      nextPreventiveAt:
        dto.preventiveIntervalDays && dto.preventiveIntervalDays > 0
          ? this.addDays(now, dto.preventiveIntervalDays)
          : null,
    });

    try {
      return await this.equipmentRepository.save(equipment);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new BadRequestException(
          `Un équipement avec le numéro de série ${dto.serialNumber} existe déjà`,
        );
      }
      throw error;
    }
  }

  async updateEquipment(
    id: string,
    dto: UpdateEquipmentDto,
  ): Promise<Equipment> {
    const equipment = await this.findEquipmentById(id);

    if (dto.serialNumber !== undefined) {
      const existing = await this.findEquipmentBySerial(dto.serialNumber);
      if (existing && existing.id !== id) {
        throw new BadRequestException(
          `Le numéro de série ${dto.serialNumber} est déjà utilisé`,
        );
      }
    }

    const update: Partial<Equipment> = {
      ...dto,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.serialNumber !== undefined
        ? { serialNumber: dto.serialNumber.trim() }
        : {}),
      ...(dto.location !== undefined
        ? { location: dto.location.trim() }
        : {}),
      ...(dto.supplier !== undefined
        ? { supplier: dto.supplier.trim() || undefined }
        : {}),
    };

    if (dto.preventiveIntervalDays !== undefined) {
      update.nextPreventiveAt =
        dto.preventiveIntervalDays > 0
          ? this.addDays(
              equipment.lastPreventiveAt ?? new Date(),
              dto.preventiveIntervalDays,
            )
          : null;
    }

    if (dto.usageCount !== undefined) {
      update.usageAtLastPreventive = Math.min(
        equipment.usageAtLastPreventive,
        dto.usageCount,
      );
    }

    if (dto.runningHours !== undefined) {
      update.runningHoursAtLastPreventive = Math.min(
        equipment.runningHoursAtLastPreventive,
        dto.runningHours,
      );
    }

    await this.equipmentRepository.update(id, update);

    return this.findEquipmentById(id);
  }

  async deleteEquipment(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const equipment = await this.getEquipmentForUpdate(manager, id);
      // Les tickets sont rattachés à l'équipement : on supprime d'abord
      // l'historique d'interventions pour respecter la clé étrangère.
      await manager.getRepository(MaintenanceTicket).delete({
        equipmentId: id,
      });
      await manager.getRepository(Equipment).remove(equipment);
    });
  }

  /** --- Tickets de maintenance --- */

  async findAllTickets(): Promise<MaintenanceTicket[]> {
    return this.maintenanceTicketRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findTicketById(id: string): Promise<MaintenanceTicket> {
    const ticket = await this.maintenanceTicketRepository.findOne({
      where: { id },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }

    return ticket;
  }

  async findTicketsByEquipment(
    equipmentId: string,
  ): Promise<MaintenanceTicket[]> {
    return this.maintenanceTicketRepository.find({
      where: { equipmentId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Signale un incident correctif sur un équipement.
   *
   * L'équipement est verrouillé pendant toute l'opération afin que la création
   * du ticket et le recalcul du statut soient atomiques.
   */
  async reportIncident(dto: ReportIncidentDto): Promise<MaintenanceTicket> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.getEquipmentForUpdate(manager, dto.equipmentId);
      const ticketRepository = manager.getRepository(MaintenanceTicket);

      const ticket = ticketRepository.create({
        equipmentId: dto.equipmentId,
        reportedByUserId: dto.reportedByUserId,
        description: dto.description.trim(),
        type: MaintenanceTicketType.CORRECTIF,
        priority: dto.priority ?? MaintenancePriority.MOYENNE,
        status: MaintenanceTicketStatus.OUVERT,
      });

      const savedTicket = await ticketRepository.save(ticket);
      await this.syncEquipmentStatus(manager, equipment);

      return savedTicket;
    });
  }

  /**
   * Planifie une maintenance préventive.
   *
   * Un seul ticket préventif ouvert est autorisé par équipement. L'index
   * unique partiel en base sert de garde-fou supplémentaire en cas de
   * planification concurrente.
   */
  async schedulePreventiveMaintenance(
    dto: SchedulePreventiveDto,
  ): Promise<MaintenanceTicket> {
    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.getEquipmentForUpdate(manager, dto.equipmentId);
      const ticketRepository = manager.getRepository(MaintenanceTicket);

      const existing = await this.findOpenPreventiveTicket(
        manager,
        dto.equipmentId,
      );

      if (existing) {
        throw new ConflictException(
          `Une maintenance préventive est déjà ouverte pour l'équipement ${dto.equipmentId}`,
        );
      }

      const ticket = ticketRepository.create({
        equipmentId: dto.equipmentId,
        reportedByUserId: dto.reportedByUserId,
        description: dto.description.trim(),
        type: MaintenanceTicketType.PREVENTIF,
        priority: dto.priority ?? MaintenancePriority.MOYENNE,
        status: MaintenanceTicketStatus.OUVERT,
        scheduledAt: dto.scheduledAt,
        technician: dto.technician?.trim() || null,
      });

      const savedTicket = await ticketRepository.save(ticket);

      if (!equipment.nextPreventiveAt || dto.scheduledAt < equipment.nextPreventiveAt) {
        equipment.nextPreventiveAt = dto.scheduledAt;
      }

      await this.syncEquipmentStatus(manager, equipment);

      return savedTicket;
    });
  }

  /**
   * Met à jour le suivi d'une intervention.
   *
   * Lorsqu'un ticket préventif passe à RESOLU, la date de dernière préventive
   * et les compteurs de cycle de l'équipement sont mis à jour.
   */
  async updateTicket(
    id: string,
    dto: UpdateTicketDto,
  ): Promise<MaintenanceTicket> {
    const existingTicket = await this.findTicketById(id);

    return this.dataSource.transaction(async (manager) => {
      // Ordre de verrouillage constant : équipement puis ticket.
      const equipment = await this.getEquipmentForUpdate(
        manager,
        existingTicket.equipmentId,
      );
      const ticketRepository = manager.getRepository(MaintenanceTicket);

      const ticket = await ticketRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!ticket) {
        throw new NotFoundException(`Ticket ${id} introuvable`);
      }

      if (
        ticket.type === MaintenanceTicketType.PREVENTIF &&
        dto.status !== undefined &&
        dto.status !== MaintenanceTicketStatus.RESOLU
      ) {
        const otherOpen = await this.findOpenPreventiveTicket(
          manager,
          ticket.equipmentId,
          ticket.id,
        );

        if (otherOpen) {
          throw new ConflictException(
            `Un autre ticket préventif est déjà ouvert pour l'équipement ${ticket.equipmentId}`,
          );
        }
      }

      const wasResolved = ticket.status === MaintenanceTicketStatus.RESOLU;

      if (dto.status !== undefined) {
        ticket.status = dto.status;

        if (dto.status === MaintenanceTicketStatus.RESOLU) {
          ticket.resolvedAt = dto.resolvedAt ?? ticket.resolvedAt ?? new Date();
        } else {
          ticket.resolvedAt = null;
        }
      }

      if (dto.resolvedAt !== undefined) {
        ticket.resolvedAt = dto.resolvedAt;
      }

      if (dto.cost !== undefined) {
        ticket.cost = dto.cost;
      }

      if (dto.technician !== undefined) {
        ticket.technician = dto.technician.trim() || null;
      }

      if (dto.partsReplaced !== undefined) {
        ticket.partsReplaced = dto.partsReplaced.trim() || null;
      }

      if (dto.scheduledAt !== undefined) {
        ticket.scheduledAt = dto.scheduledAt;
      }

      const savedTicket = await ticketRepository.save(ticket);

      if (
        ticket.type === MaintenanceTicketType.PREVENTIF &&
        ticket.status === MaintenanceTicketStatus.RESOLU &&
        !wasResolved
      ) {
        equipment.applyPreventiveCompletion(ticket.resolvedAt ?? new Date());
      }

      await this.syncEquipmentStatus(manager, equipment);

      return savedTicket;
    });
  }

  async deleteTicket(id: string): Promise<void> {
    const existingTicket = await this.findTicketById(id);

    await this.dataSource.transaction(async (manager) => {
      const equipment = await this.getEquipmentForUpdate(
        manager,
        existingTicket.equipmentId,
      );
      const ticketRepository = manager.getRepository(MaintenanceTicket);

      const ticket = await ticketRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (ticket) {
        await ticketRepository.remove(ticket);
      }

      await this.syncEquipmentStatus(manager, equipment);
    });
  }

  /** --- Cycles d'utilisation et préventive automatique --- */

  /**
   * Enregistre une utilisation (passage, mise en marche, heures) de manière
   * atomique et déclenche automatiquement une préventive si un seuil est atteint.
   */
  async recordUsage(
    equipmentId: string,
    dto: RecordEquipmentUsageDto,
  ): Promise<RecordUsageResult> {
    const usageIncrement = dto.usageIncrement ?? 1;
    const runningHoursIncrement = dto.runningHoursIncrement ?? 0;

    if (usageIncrement <= 0 && runningHoursIncrement <= 0) {
      throw new BadRequestException(
        "L'utilisation doit incrémenter au moins le compteur d'utilisations ou d'heures.",
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const equipment = await this.getEquipmentForUpdate(manager, equipmentId);

      if (!equipment.isAvailable()) {
        throw new ConflictException(
          `L'équipement ${equipment.name} n'est pas disponible à l'usage (${equipment.status}).`,
        );
      }

      equipment.recordUsage(usageIncrement, runningHoursIncrement);

      let preventiveTicket: MaintenanceTicket | undefined;

      if (equipment.needsPreventive()) {
        preventiveTicket =
          (await this.findOpenPreventiveTicket(manager, equipment.id)) ??
          (await this.createAutomaticPreventiveTicket(
            manager,
            equipment,
            dto.reportedByUserId,
          ));
      }

      await this.syncEquipmentStatus(manager, equipment);

      return { equipment, preventiveTicket };
    });
  }

  /**
   * Génère les tickets préventifs dus pour tous les équipements.
   *
   * Peut être appelée par un cron ou manuellement. Chaque équipement est
   * traité dans sa propre transaction avec verrou pessimiste.
   */
  async generateDuePreventiveTickets(): Promise<PreventiveRunResult> {
    const now = new Date();
    const candidates = await this.equipmentRepository
      .createQueryBuilder('equipment')
      .where(
        'equipment.nextPreventiveAt IS NOT NULL AND equipment.nextPreventiveAt <= :now',
        { now },
      )
      .orWhere(
        'equipment.preventiveUsageThreshold IS NOT NULL AND equipment.usageCount - equipment.usageAtLastPreventive >= equipment.preventiveUsageThreshold',
      )
      .orWhere(
        'equipment.preventiveRunningHoursThreshold IS NOT NULL AND equipment.runningHours - equipment.runningHoursAtLastPreventive >= equipment.preventiveRunningHoursThreshold',
      )
      .getMany();

    const createdTickets: MaintenanceTicket[] = [];

    for (const candidate of candidates) {
      const ticket = await this.dataSource.transaction(async (manager) => {
        const equipment = await this.getEquipmentForUpdate(
          manager,
          candidate.id,
        );

        if (!equipment.needsPreventive(now)) {
          return null;
        }

        const existing = await this.findOpenPreventiveTicket(
          manager,
          equipment.id,
        );

        if (existing) {
          return null;
        }

        const savedTicket = await this.createAutomaticPreventiveTicket(
          manager,
          equipment,
          'SYSTEM',
        );

        await this.syncEquipmentStatus(manager, equipment);

        return savedTicket;
      });

      if (ticket) {
        createdTickets.push(ticket);
      }
    }

    return { createdTickets };
  }

  /** --- Suivi des coûts d'intervention --- */

  async getCostSummary(): Promise<TicketCostSummary> {
    const summary = await this.maintenanceTicketRepository
      .createQueryBuilder('ticket')
      .select('COUNT(*)', 'totalTickets')
      .addSelect('COALESCE(SUM(ticket.cost), 0)', 'totalCost')
      .addSelect(
        'COUNT(*) FILTER (WHERE ticket.status = :resolved)',
        'resolvedTickets',
      )
      .setParameter('resolved', MaintenanceTicketStatus.RESOLU)
      .getRawOne<{
        totalTickets: string;
        totalCost: string;
        resolvedTickets: string;
      }>();

    const totalTickets = Number(summary?.totalTickets ?? 0);
    const resolvedTickets = Number(summary?.resolvedTickets ?? 0);

    return {
      totalTickets,
      totalCost: Number(summary?.totalCost ?? 0),
      resolvedTickets,
      openTickets: totalTickets - resolvedTickets,
    };
  }

  /** --- Helpers transactionnels --- */

  private async getEquipmentForUpdate(
    manager: EntityManager,
    id: string,
  ): Promise<Equipment> {
    const equipment = await manager
      .getRepository(Equipment)
      .createQueryBuilder('equipment')
      .setLock('pessimistic_write')
      .where('equipment.id = :id', { id })
      .getOne();

    if (!equipment) {
      throw new NotFoundException(`Équipement ${id} introuvable`);
    }

    return equipment;
  }

  private async findOpenPreventiveTicket(
    manager: EntityManager,
    equipmentId: string,
    excludedTicketId?: string,
  ): Promise<MaintenanceTicket | null> {
    const query = manager
      .getRepository(MaintenanceTicket)
      .createQueryBuilder('ticket')
      .where('ticket.equipmentId = :equipmentId', { equipmentId })
      .andWhere('ticket.type = :type', {
        type: MaintenanceTicketType.PREVENTIF,
      })
      .andWhere('ticket.status != :resolved', {
        resolved: MaintenanceTicketStatus.RESOLU,
      });

    if (excludedTicketId) {
      query.andWhere('ticket.id != :excludedTicketId', { excludedTicketId });
    }

    return query.getOne();
  }

  private async createAutomaticPreventiveTicket(
    manager: EntityManager,
    equipment: Equipment,
    reportedByUserId = 'SYSTEM',
  ): Promise<MaintenanceTicket> {
    const ticketRepository = manager.getRepository(MaintenanceTicket);

    const ticket = ticketRepository.create({
      equipmentId: equipment.id,
      reportedByUserId,
      description:
        `Maintenance préventive automatique : seuil atteint ` +
        `(${equipment.usageCount} utilisations, ${equipment.runningHours} h).`,
      type: MaintenanceTicketType.PREVENTIF,
      priority: MaintenancePriority.MOYENNE,
      status: MaintenanceTicketStatus.OUVERT,
      scheduledAt: new Date(),
    });

    return ticketRepository.save(ticket);
  }

  /** Recalcule le statut de l'équipement à partir de ses tickets ouverts. */
  private async syncEquipmentStatus(
    manager: EntityManager,
    equipment: Equipment,
  ): Promise<void> {
    const ticketRepository = manager.getRepository(MaintenanceTicket);

    const [openCorrective, openPreventive] = await Promise.all([
      ticketRepository.count({
        where: {
          equipmentId: equipment.id,
          type: MaintenanceTicketType.CORRECTIF,
          status: Not(MaintenanceTicketStatus.RESOLU),
        },
      }),
      ticketRepository.count({
        where: {
          equipmentId: equipment.id,
          type: MaintenanceTicketType.PREVENTIF,
          status: Not(MaintenanceTicketStatus.RESOLU),
        },
      }),
    ]);

    let nextStatus = EquipmentStatus.ACTIF;

    if (openCorrective > 0) {
      nextStatus = EquipmentStatus.EN_PANNE;
    } else if (openPreventive > 0) {
      nextStatus = EquipmentStatus.EN_MAINTENANCE;
    }

    equipment.status = nextStatus;
    await manager.getRepository(Equipment).save(equipment);
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private isUniqueViolation(error: unknown): boolean {
    const candidate = error as {
      code?: string;
      driverError?: { code?: string };
    };

    return (
      candidate?.code === '23505' ||
      candidate?.driverError?.code === '23505'
    );
  }
}
