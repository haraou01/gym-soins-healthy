import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { writeJsonLog } from './json-logger';

interface RequestWithContext extends Request {
  requestId?: string;
  user?: { id?: string; role?: string };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithContext>();

    if (response.headersSent) {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : this.resolveStatus(exception);

    const rawResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const baseResponse =
      typeof rawResponse === 'string'
        ? { message: rawResponse }
        : rawResponse && typeof rawResponse === 'object'
          ? (rawResponse as Record<string, unknown>)
          : {
              message:
                status >= 500
                  ? 'Internal server error'
                  : exception instanceof Error
                    ? exception.message
                    : 'Une erreur est survenue',
            };

    const requestId = request.requestId ?? null;
    const body = {
      ...baseResponse,
      statusCode: status,
      requestId,
    };

    writeJsonLog(
      status >= 500 ? 'error' : 'warn',
      'http.error',
      'Exceptions',
      {
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: status,
        userId: request.user?.id ?? null,
        role: request.user?.role ?? null,
        error:
          exception instanceof Error
            ? exception.name
            : 'UnknownException',
        message:
          exception instanceof Error
            ? exception.message
            : String(exception),
        stack:
          status >= 500 && exception instanceof Error
            ? exception.stack
            : undefined,
      },
    );

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception && typeof exception === 'object') {
      const candidate = exception as {
        statusCode?: unknown;
        status?: unknown;
      };
      const status = Number(candidate.statusCode ?? candidate.status);

      if (Number.isInteger(status) && status >= 400 && status <= 599) {
        return status;
      }
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
