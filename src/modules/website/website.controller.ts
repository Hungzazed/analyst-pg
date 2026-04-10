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
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { WebsiteService } from './website.service';

@Controller('websites')
@UseGuards(JwtAuthGuard)
export class WebsiteController {
  constructor(private readonly websiteService: WebsiteService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.websiteService.findAll(user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.findOne(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() createWebsiteDto: CreateWebsiteDto) {
    return this.websiteService.create(user.id, createWebsiteDto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateWebsiteDto: UpdateWebsiteDto,
  ) {
    return this.websiteService.update(user.id, id, updateWebsiteDto);
  }

  @Post(':id/api-keys')
  createApiKey(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.createApiKey(user.id, id);
  }

  @Get(':id/api-keys')
  getActiveApiKeys(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.getActiveApiKeys(user.id, id);
  }

  @Patch(':id/api-keys/:apiKeyId/revoke')
  revokeApiKey(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('apiKeyId', new ParseUUIDPipe()) apiKeyId: string,
  ) {
    return this.websiteService.revokeApiKey(user.id, id, apiKeyId);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.websiteService.remove(user.id, id);
  }
}
