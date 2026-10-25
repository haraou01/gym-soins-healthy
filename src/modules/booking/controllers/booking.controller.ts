import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import { BookingService } from '../services/booking.service';
import { CreateBookingDto } from '../dto/booking.dto';
import { BookingResourceType } from '../entities/booking.entity';

@Controller('api/v1/bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /** Créer une réservation avec vérification anti-conflit. */
  @Post()
  async createBooking(@Body() dto: CreateBookingDto) {
    try {
      return await this.bookingService.createBooking(dto);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new BadRequestException('Échec de la création de réservation');
    }
  }

  /** Annuler une réservation. */
  @Delete(':id')
  async cancelBooking(@Param('id') id: string) {
    try {
      return await this.bookingService.cancelBooking(id);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new NotFoundException(`Booking ${id} introuvable`);
    }
  }

  /** Liste de toutes les réservations. */
  @Get()
  async findAll() {
    return this.bookingService.findAllBookings();
  }

  /** Plannings d'un client. */
  @Get('client/:clientId')
  async getByClient(@Param('clientId') clientId: string) {
    return this.bookingService.findBookingsByClient(clientId);
  }

  /** Plannings d'une ressource (cours, soin, matériel). */
  @Get('resource/:resourceType/:resourceId')
  async getByResource(
    @Param('resourceType', new ParseEnumPipe(BookingResourceType))
    resourceType: BookingResourceType,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
  ) {
    return this.bookingService.findBookingsByResource(resourceType, resourceId);
  }

  /** Agenda d'un praticien/coach. */
  @Get('practitioner/:practitionerId')
  async getByPractitioner(@Param('practitionerId') practitionerId: string) {
    return this.bookingService.findBookingsByPractitioner(practitionerId);
  }
}
