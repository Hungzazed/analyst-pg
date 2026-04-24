import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { IngestMetricDto } from './dto/ingest-metric.dto';
import { MetricsService } from './metrics.service';

@Controller('metrics')
@ApiTags('Metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Post('events')
  @ApiOperation({ summary: 'Ingest analytics event' })
  @ApiHeader({
    name: 'x-api-key',
    required: true,
    description: 'Website API key',
  })
  @ApiOkResponse({ description: 'Event ingested successfully' })
  @ApiBadRequestResponse({ description: 'Missing x-api-key or invalid payload' })
  ingestEvent(
    @Headers('x-api-key') apiKey: string | undefined,
    @Body() ingestMetricDto: IngestMetricDto,
    @Req() request: Request,
  ) {
    if (!apiKey) {
      throw new BadRequestException('x-api-key header is required');
    }

    const forwarded = request.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]?.trim();
    const userAgent = request.headers['user-agent'];

    return this.metricsService.ingestEvent({
      apiKey,
      dto: ingestMetricDto,
      ip: ingestMetricDto.ip ?? forwardedIp ?? request.ip,
      userAgent:
        ingestMetricDto.userAgent ??
        (Array.isArray(userAgent) ? userAgent[0] : userAgent),
    });
  }
}
