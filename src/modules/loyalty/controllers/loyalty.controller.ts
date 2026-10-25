import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';

import { LoyaltyMovementDto } from '../dto/loyalty.dto';
import { LoyaltyService } from '../services/loyalty.service';

@Controller('api/v1/loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  /** Liste de tous les comptes de fidélité. */
  @Get()
  async findAllAccounts() {
    return this.loyaltyService.findAllAccounts();
  }

  /** Solde de points d'un client (identifiant client ou email). */
  @Get('balance/:identifier')
  async getBalance(@Param('identifier') identifier: string) {
    return this.loyaltyService.getBalance(identifier);
  }

  /** Historique chronologique des mouvements de points d'un client. */
  @Get('transactions/:identifier')
  async getTransactions(@Param('identifier') identifier: string) {
    try {
      return await this.loyaltyService.getTransactions(identifier);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(
        `Aucun compte de fidélité pour « ${identifier} »`,
      );
    }
  }

  /** Créditer des points (achat, check-in, geste commercial...). */
  @Post('credit')
  async credit(@Body() dto: LoyaltyMovementDto) {
    return this.loyaltyService.credit(dto);
  }

  /** Débiter des points (utilisation d'une récompense), avec contrôle de solde. */
  @Post('debit')
  async debit(@Body() dto: LoyaltyMovementDto) {
    return this.loyaltyService.debit(dto);
  }
}
