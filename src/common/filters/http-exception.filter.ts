import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ExceptionResponse =
  | string
  | {
      message?: string | string[];
      error?: string;
      [key: string]: unknown;
    };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException
      ? (exception.getResponse() as ExceptionResponse)
      : null;

    const message = this.getMessage(exceptionResponse, statusCode);
    const error = this.getError(exceptionResponse, statusCode);

    response.status(statusCode).json({
      success: false,
      statusCode,
      message,
      error,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    });
  }

  private getMessage(
    response: ExceptionResponse | null,
    statusCode: number,
  ): string | string[] {
    if (!response) {
      return 'Internal server error';
    }

    if (typeof response === 'string') {
      return response;
    }

    if (Array.isArray(response.message)) {
      return response.message;
    }

    if (typeof response.message === 'string') {
      return response.message;
    }

    if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Internal server error';
    }

    return 'Request failed';
  }

  private getError(
    response: ExceptionResponse | null,
    statusCode: number,
  ): string {
    if (!response) {
      return HttpStatus[statusCode] ?? 'Error';
    }

    if (typeof response === 'object' && typeof response.error === 'string') {
      return response.error;
    }

    return HttpStatus[statusCode] ?? 'Error';
  }
}
