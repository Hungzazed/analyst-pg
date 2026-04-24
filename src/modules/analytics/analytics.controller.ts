import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { FunnelQueryDto } from './dto/funnel-query.dto';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
@ApiTags('Analytics')
@ApiBearerAuth('access-token')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':websiteId/overview')
  @ApiOperation({ summary: 'Get analytics overview' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Overview data fetched successfully' })
  getOverview(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOverview(user.id, websiteId, query);
  }

  @Get(':websiteId/top-pages')
  @ApiOperation({ summary: 'Get top pages' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Top pages fetched successfully' })
  getTopPages(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopPages(user.id, websiteId, query);
  }

  @Get(':websiteId/traffic-sources')
  @ApiOperation({ summary: 'Get traffic sources' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Traffic sources fetched successfully' })
  getTrafficSources(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTrafficSources(user.id, websiteId, query);
  }

  @Get(':websiteId/behavior')
  @ApiOperation({ summary: 'Get user behavior analytics' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Behavior analytics fetched successfully' })
  getBehavior(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getBehavior(user.id, websiteId, query);
  }

  @Get(':websiteId/devices')
  @ApiOperation({ summary: 'Get device analytics' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Device analytics fetched successfully' })
  getDevices(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getDeviceAnalytics(user.id, websiteId, query);
  }

  @Get(':websiteId/geo')
  @ApiOperation({ summary: 'Get geographic analytics' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Geo analytics fetched successfully' })
  getGeo(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getGeoAnalytics(user.id, websiteId, query);
  }

  @Get(':websiteId/funnel')
  @ApiOperation({ summary: 'Get funnel analytics' })
  @ApiParam({ name: 'websiteId', format: 'uuid' })
  @ApiOkResponse({ description: 'Funnel analytics fetched successfully' })
  getFunnel(
    @CurrentUser() user: AuthUser,
    @Param('websiteId', new ParseUUIDPipe()) websiteId: string,
    @Query() query: FunnelQueryDto,
  ) {
    return this.analyticsService.getFunnel(user.id, websiteId, query);
  }
}