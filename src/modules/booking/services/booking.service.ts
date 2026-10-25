import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Booking, BookingResourceType, BookingStatus } from '../entities/booking.entity';
import type { CreateBookingDto } from '../dto/booking.dto';

export interface UpdateBookingDto {
  status?: BookingStatus;
}

export interface ConflictCheck {
  hasConflict: boolean;
  conflictingBooking?: Booking;
  reason?: string;
}

@Injectable()
export class BookingService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** --- Création de réservation transactionnelle et anti-conflit --- */

  async createBooking(dto: CreateBookingDto): Promise<Booking> {
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException(
        'L\'heure de début doit être antérieure à l\'heure de fin',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. Sérialiser les créations concurrentes pour la ressource et le praticien.
      //    Les verrous sont pris dans un ordre déterministe pour éviter les deadlocks.
      await this.acquireBookingLocks(manager, dto);

      // 2. Vérifier le chevauchement directement en SQL, dans la transaction.
      const resourceConflict = await this.checkResourceConflict(
        manager,
        dto.resourceType,
        dto.resourceId,
        dto.startTime,
        dto.endTime,
      );

      if (resourceConflict.hasConflict) {
        throw new ConflictException(
          `Conflit de réservation sur la ressource ${dto.resourceId} : ${resourceConflict.reason}`,
        );
      }

      const practitionerConflict = await this.checkPractitionerConflict(
        manager,
        dto.practitionerOrCoachId,
        dto.startTime,
        dto.endTime,
      );

      if (practitionerConflict.hasConflict) {
        throw new ConflictException(
          `Conflit de planning pour le praticien ${dto.practitionerOrCoachId} : ${practitionerConflict.reason}`,
        );
      }

      // 3. Création atomique : le verrou est libéré au commit de la transaction.
      const repository = manager.getRepository(Booking);
      const booking = repository.create({
        clientId: dto.clientId,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        practitionerOrCoachId: dto.practitionerOrCoachId,
        startTime: dto.startTime,
        endTime: dto.endTime,
        status: BookingStatus.CONFIRME,
      });

      return repository.save(booking);
    });
  }

  /**
   * Prend des verrous consultatifs PostgreSQL transactionnels.
   *
   * `pg_advisory_xact_lock` est partagé par toutes les instances applicatives
   * connectées à la même base : deux requêtes concurrentes sur la même
   * ressource ou le même praticien sont sérialisées.
   */
  private async acquireBookingLocks(
    manager: EntityManager,
    dto: CreateBookingDto,
  ): Promise<void> {
    const lockKeys = [
      `booking:resource:${dto.resourceType}:${dto.resourceId}`,
      `booking:practitioner:${dto.practitionerOrCoachId}`,
    ];

    for (const lockKey of [...new Set(lockKeys)].sort()) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [lockKey],
      );
    }
  }

  /**
   * Vérifie qu'aucun booking CONFIRME ne chevauche le créneau de la ressource.
   *
   * Chevauchement demi-ouvert : existing.start < new.end AND existing.end > new.start.
   * La condition est exécutée en base, sans chargement global des réservations.
   */
  private async checkResourceConflict(
    manager: EntityManager,
    resourceType: BookingResourceType,
    resourceId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ConflictCheck> {
    const conflict = await manager
      .createQueryBuilder(Booking, 'booking')
      .where('booking.resourceType = :resourceType', { resourceType })
      .andWhere('booking.resourceId = :resourceId', { resourceId })
      .andWhere('booking.status = :status', { status: BookingStatus.CONFIRME })
      .andWhere('booking.startTime < :endTime', { endTime })
      .andWhere('booking.endTime > :startTime', { startTime })
      .orderBy('booking.startTime', 'ASC')
      .getOne();

    return this.toConflictCheck(conflict);
  }

  /**
   * Vérifie qu'aucun booking CONFIRME ne chevauche le créneau du praticien.
   */
  private async checkPractitionerConflict(
    manager: EntityManager,
    practitionerOrCoachId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<ConflictCheck> {
    const conflict = await manager
      .createQueryBuilder(Booking, 'booking')
      .where('booking.practitionerOrCoachId = :practitionerOrCoachId', {
        practitionerOrCoachId,
      })
      .andWhere('booking.status = :status', { status: BookingStatus.CONFIRME })
      .andWhere('booking.startTime < :endTime', { endTime })
      .andWhere('booking.endTime > :startTime', { startTime })
      .orderBy('booking.startTime', 'ASC')
      .getOne();

    return this.toConflictCheck(conflict);
  }

  private toConflictCheck(conflict: Booking | null): ConflictCheck {
    if (!conflict) {
      return { hasConflict: false };
    }

    return {
      hasConflict: true,
      conflictingBooking: conflict,
      reason: `Déjà réservé de ${conflict.startTime.toISOString()} à ${conflict.endTime.toISOString()}`,
    };
  }

  /** --- Annulation et consultation --- */

  async cancelBooking(id: string): Promise<Booking> {
    const booking = await this.findBookingById(id);

    if (booking.status === BookingStatus.ANNULE) {
      throw new BadRequestException(`Le booking ${id} est déjà annulé`);
    }

    if (booking.status === BookingStatus.TERMINE) {
      throw new BadRequestException(
        `Impossible d'annuler un booking terminé`,
      );
    }

    booking.status = BookingStatus.ANNULE;
    return this.bookingRepository.save(booking);
  }

  async findBookingById(id: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id } });

    if (!booking) {
      throw new NotFoundException(`Booking ${id} introuvable`);
    }

    return booking;
  }

  async findAllBookings(): Promise<Booking[]> {
    return this.bookingRepository.find({ order: { startTime: 'ASC' } });
  }

  async findBookingsByClient(clientId: string): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { clientId },
      order: { startTime: 'ASC' },
    });
  }

  async findBookingsByResource(
    resourceType: BookingResourceType,
    resourceId: string,
  ): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { resourceType, resourceId },
      order: { startTime: 'ASC' },
    });
  }

  async findBookingsByPractitioner(practitionerOrCoachId: string): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { practitionerOrCoachId },
      order: { startTime: 'ASC' },
    });
  }

  async findConfirmedBookingsInRange(
    startTime: Date,
    endTime: Date,
  ): Promise<Booking[]> {
    return this.bookingRepository
      .createQueryBuilder('booking')
      .where('booking.status = :status', { status: BookingStatus.CONFIRME })
      .andWhere('booking.startTime < :endTime', { endTime })
      .andWhere('booking.endTime > :startTime', { startTime })
      .orderBy('booking.startTime', 'ASC')
      .getMany();
  }
}
