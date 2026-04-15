import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':websiteId/overview')
  getOverview(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOverview(user.id, websiteId, query);
  }

  @Get(':websiteId/top-pages')
  getTopPages(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopPages(user.id, websiteId, query);
  }

  @Get(':websiteId/traffic-sources')
  getTrafficSources(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTrafficSources(user.id, websiteId, query);
  }

  @Get(':websiteId/behavior')
  getBehavior(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getBehavior(user.id, websiteId, query);
  }

  @Get(':websiteId/devices')
  getDevices(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getDeviceAnalytics(user.id, websiteId, query);
  }

  @Get(':websiteId/geo')
  getGeo(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getGeoAnalytics(user.id, websiteId, query);
  }

  @Get(':websiteId/funnel')
  getFunnel(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: FunnelQueryDto,
  ) {
    return this.analyticsService.getFunnel(user.id, websiteId, query);
  }
}