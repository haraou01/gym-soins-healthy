import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  CareService as CareServiceEntity,
  CareServiceType,
} from '../entities/care-service.entity';
import {
  ClientCarePackage,
  ClientCarePackageStatus,
} from '../entities/client-care-package.entity';
import {
  IdempotencyService,
  IDEMPOTENCY_SCOPES,
} from '../../../core/idempotency';
import { CareSession } from '../entities/care-session.entity';
import type { AssignPackageDto, ConsumeSessionDto } from '../dto/care.dto';

export interface CareSessionResult {
  session: CareSession;
  remainingSessions: number;
  packageId: string;
}

@Injectable()
export class CareService {
  constructor(
    @InjectRepository(CareServiceEntity)
    private readonly careServiceRepository: Repository<CareServiceEntity>,
    @InjectRepository(ClientCarePackage)
    private readonly clientCarePackageRepository: Repository<ClientCarePackage>,
    @InjectRepository(CareSession)
    private readonly careSessionRepository: Repository<CareSession>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /** --- Catalogue des soins --- */

  async findAllCareServices(): Promise<CareServiceEntity[]> {
    return this.careServiceRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findCareServiceById(id: string): Promise<CareServiceEntity> {
    const careService = await this.careServiceRepository.findOne({ where: { id } });

    if (!careService) {
      throw new NotFoundException(`Soin ${id} introuvable`);
    }

    return careService;
  }

  async createCareService(data: Partial<CareServiceEntity>): Promise<CareServiceEntity> {
    const entity = this.careServiceRepository.create(data);
    return this.careServiceRepository.save(entity);
  }

  async updateCareService(id: string, data: Partial<CareServiceEntity>): Promise<CareServiceEntity> {
    await this.findCareServiceById(id);
    await this.careServiceRepository.update(id, data);
    return this.findCareServiceById(id);
  }

  async deleteCareService(id: string): Promise<void> {
    const careService = await this.findCareServiceById(id);
    await this.careServiceRepository.remove(careService);
  }

  /** --- Achat / attribution de packs aux clients --- */

  /**
   * Crée un pack de séances pour un client.
   *
   * L'opération est transactionnelle afin que la validation du catalogue et
   * l'insertion du pack forment une seule unité cohérente.
   */
  async assignPackage(dto: AssignPackageDto): Promise<ClientCarePackage> {
    return this.dataSource.transaction(async (manager) => {
      const careServiceRepository = manager.getRepository(CareServiceEntity);
      const packageRepository = manager.getRepository(ClientCarePackage);

      const careService = await careServiceRepository.findOne({
        where: { id: dto.careServiceId },
      });

      if (!careService) {
        throw new NotFoundException(`Soin ${dto.careServiceId} introuvable`);
      }

      if (careService.type !== CareServiceType.PACK) {
        throw new BadRequestException(
          `Le soin ${dto.careServiceId} n'est pas un pack (type ${careService.type})`,
        );
      }

      if (dto.totalSessions <= 0) {
        throw new BadRequestException(
          'Le nombre total de séances doit être supérieur à 0',
        );
      }

      const packageEntity = packageRepository.create({
        clientId: dto.clientId,
        careServiceId: dto.careServiceId,
        totalSessions: dto.totalSessions,
        remainingSessions: dto.totalSessions,
        status: ClientCarePackageStatus.ACTIF,
      });

      return packageRepository.save(packageEntity);
    });
  }

  async findPackagesByClient(clientId: string): Promise<ClientCarePackage[]> {
    return this.clientCarePackageRepository.find({
      where: { clientId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lecture seule du premier pack utilisable (FIFO).
   *
   * Cette méthode ne doit pas être utilisée pour consommer une séance :
   * `consumeSession()` verrouille les lignes dans une transaction.
   */
  async findUsablePackage(
    clientId: string,
    careServiceId: string,
  ): Promise<ClientCarePackage> {
    const usablePackage = await this.clientCarePackageRepository
      .createQueryBuilder('pack')
      .where('pack.clientId = :clientId', { clientId })
      .andWhere('pack.careServiceId = :careServiceId', { careServiceId })
      .andWhere('pack.status = :status', {
        status: ClientCarePackageStatus.ACTIF,
      })
      .andWhere('pack.remainingSessions > 0')
      .orderBy('pack.createdAt', 'ASC')
      .getOne();

    if (!usablePackage) {
      throw new NotFoundException(
        `Aucun pack actif avec solde disponible pour le soin ${careServiceId}`,
      );
    }

    return usablePackage;
  }

  /** --- Consommation atomique d'une séance --- */

  /**
   * Consomme une séance sur le plus ancien pack utilisable du client.
   *
   * Toute l'opération (verrouillage, décrément, mise à jour du statut et
   * création de la séance) se déroule dans une seule transaction :
   * - `FOR UPDATE` sérialise les consommations concurrentes pour le même
   *   client et le même soin ;
   * - le solde ne peut jamais devenir négatif ;
   * - si la création de la séance échoue, le décrément est annulé.
   */
  async consumeSession(
    dto: ConsumeSessionDto,
    idempotencyKey?: string,
  ): Promise<CareSessionResult> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      return this.idempotencyService.execute(
        manager,
        IDEMPOTENCY_SCOPES.CARE_CONSUME,
        idempotencyKey,
        this.buildConsumeIdempotencyPayload(dto),
        async () => {
          const careServiceRepository = manager.getRepository(CareServiceEntity);
      const packageRepository = manager.getRepository(ClientCarePackage);
      const sessionRepository = manager.getRepository(CareSession);

      const careService = await careServiceRepository.findOne({
        where: { id: dto.careServiceId },
      });

      if (!careService) {
        throw new NotFoundException(`Soin ${dto.careServiceId} introuvable`);
      }

      if (careService.type !== CareServiceType.PACK) {
        throw new BadRequestException(
          `Le soin ${dto.careServiceId} n'est pas un pack (type ${careService.type})`,
        );
      }

      // Verrou pessimiste sur tous les packs utilisables du client pour ce soin.
      // Les transactions concurrentes attendent puis relisent l'état à jour.
      const usablePackages = await packageRepository
        .createQueryBuilder('pack')
        .setLock('pessimistic_write')
        .where('pack.clientId = :clientId', { clientId: dto.clientId })
        .andWhere('pack.careServiceId = :careServiceId', {
          careServiceId: dto.careServiceId,
        })
        .andWhere('pack.status = :status', {
          status: ClientCarePackageStatus.ACTIF,
        })
        .andWhere('pack.remainingSessions > 0')
        .orderBy('pack.createdAt', 'ASC')
        .getMany();

      const carePackage = usablePackages[0];

      if (!carePackage) {
        throw new NotFoundException(
          `Aucun pack actif avec solde disponible pour le soin ${dto.careServiceId}`,
        );
      }

      carePackage.consumeOneSession();
      await packageRepository.save(carePackage);

      const session = sessionRepository.create({
        clientId: dto.clientId,
        careServiceId: dto.careServiceId,
        therapistId: dto.therapistId,
        timestamp: dto.timestamp ?? new Date(),
        notes: dto.notes,
        packageId: carePackage.id,
      });

      const savedSession = await sessionRepository.save(session);

      return {
        session: savedSession,
        remainingSessions: carePackage.remainingSessions,
        packageId: carePackage.id,
      };
        },
      );
    });

    return outcome.value;
  }

  private buildConsumeIdempotencyPayload(dto: ConsumeSessionDto): unknown {
    return {
      clientId: dto.clientId,
      careServiceId: dto.careServiceId,
      therapistId: dto.therapistId,
      timestamp:
        dto.timestamp instanceof Date
          ? dto.timestamp.toISOString()
          : dto.timestamp ?? null,
      notes: dto.notes?.trim() || null,
    };
  }

  async findSessionsByClient(clientId: string): Promise<CareSession[]> {
    return this.careSessionRepository.find({
      where: { clientId },
      order: { timestamp: 'DESC' },
    });
  }

  async findSessionsByTherapist(therapistId: string): Promise<CareSession[]> {
    return this.careSessionRepository.find({
      where: { therapistId },
      order: { timestamp: 'DESC' },
    });
  }
}
