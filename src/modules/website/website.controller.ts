import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { WebsiteService } from './website.service';

@Controller('websites')
@UseGuards(JwtAuthGuard)
@ApiTags('Websites')
@ApiBearerAuth('access-token')
export class WebsiteController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get()
  @ApiOperation({ summary: 'List websites of current user' })
  @ApiOkResponse({ description: 'Website list fetched successfully' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.websiteService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get website by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Website fetched successfully' })
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.findOne(user.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new website' })
  @ApiOkResponse({ description: 'Website created successfully' })
  create(@CurrentUser() user: AuthUser, @Body() createWebsiteDto: CreateWebsiteDto) {
    return this.websiteService.create(user.id, createWebsiteDto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update website information' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Website updated successfully' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateWebsiteDto: UpdateWebsiteDto,
  ) {
    return this.websiteService.update(user.id, id, updateWebsiteDto);
  }

  @Post(':id/api-keys')
  @ApiOperation({ summary: 'Generate a new API key for website' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'API key generated successfully' })
  createApiKey(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.createApiKey(user.id, id);
  }

  @Get(':id/api-keys')
  @ApiOperation({ summary: 'List active API keys of website' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'API keys fetched successfully' })
  getActiveApiKeys(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.getActiveApiKeys(user.id, id);
  }

  @Patch(':id/api-keys/:apiKeyId/revoke')
  @ApiOperation({ summary: 'Revoke an active API key' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'apiKeyId', format: 'uuid' })
  @ApiOkResponse({ description: 'API key revoked successfully' })
  revokeApiKey(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('apiKeyId', new ParseUUIDPipe()) apiKeyId: string,
  ) {
    return this.websiteService.revokeApiKey(user.id, id, apiKeyId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a website' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ description: 'Website deleted successfully' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.remove(user.id, id);
  }
}
