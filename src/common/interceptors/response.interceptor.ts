import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface ApiSuccessResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  path: string;
  timestamp: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ originalUrl?: string; url?: string }>();
    const response = http.getResponse<{ statusCode: number }>();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        statusCode: response.statusCode,
        message: 'Success',
        path: request.originalUrl ?? request.url ?? '',
        timestamp: new Date().toISOString(),
        data,
      })),
    );
  }
}
