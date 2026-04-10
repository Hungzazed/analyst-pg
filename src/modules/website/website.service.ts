import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { generateApiKey } from './utils/generate-api-key.util';

const MAX_ACTIVE_API_KEYS_PER_WEBSITE = 5;

@Injectable()
export class WebsiteService {
  constructor(private readonly prismaService: PrismaService) {}

  async findAll(userId: string) {
    return this.prismaService.website.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        domain: true,
        userId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(userId: string, websiteId: string) {
    const website = await this.prismaService.website.findUnique({
      where: { id: websiteId },
      select: {
        id: true,
        name: true,
        domain: true,
        userId: true,
        createdAt: true,
      },
    });

    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.userId !== userId) {
      throw new ForbiddenException('You do not have permission to view this website');
    }

    return website;
  }

  async create(userId: string, createWebsiteDto: CreateWebsiteDto) {
    const normalizedDomain = createWebsiteDto.domain.toLowerCase();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const apiKey = generateApiKey();

      try {
        const website = await this.prismaService.website.create({
          data: {
            userId,
            name: createWebsiteDto.name,
            domain: normalizedDomain,
            apiKeys: {
              create: {
                key: apiKey,
              },
            },
          },
          select: {
            id: true,
            name: true,
            domain: true,
            userId: true,
            createdAt: true,
            apiKeys: {
              where: { revoked: false },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                key: true,
                createdAt: true,
              },
            },
          },
        });

        return {
          id: website.id,
          name: website.name,
          domain: website.domain,
          userId: website.userId,
          createdAt: website.createdAt,
          apiKey: website.apiKeys[0]?.key ?? apiKey,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = this.getUniqueTarget(error);

          if (target.includes('domain')) {
            throw new ConflictException('Domain already exists');
          }

          if (target.includes('key')) {
            continue;
          }
        }

        throw error;
      }
    }

    throw new ConflictException('Failed to generate unique API key, please retry');
  }

  async createApiKey(userId: string, websiteId: string) {
    await this.assertWebsiteOwnership(userId, websiteId);

    const activeApiKeysCount = await this.prismaService.apiKey.count({
      where: {
        websiteId,
        revoked: false,
      },
    });

    if (activeApiKeysCount >= MAX_ACTIVE_API_KEYS_PER_WEBSITE) {
      throw new ConflictException('Maximum 5 active API keys per website');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = generateApiKey();

      try {
        return await this.prismaService.apiKey.create({
          data: {
            websiteId,
            key,
          },
          select: {
            id: true,
            key: true,
            websiteId: true,
            createdAt: true,
            revoked: true,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const target = this.getUniqueTarget(error);

          if (target.includes('key')) {
            continue;
          }
        }

        throw error;
      }
    }

    throw new ConflictException('Failed to generate unique API key, please retry');
  }

  async getActiveApiKeys(userId: string, websiteId: string) {
    await this.assertWebsiteOwnership(userId, websiteId);

    return this.prismaService.apiKey.findMany({
      where: {
        websiteId,
        revoked: false,
      },
      select: {
        id: true,
        key: true,
        websiteId: true,
        createdAt: true,
        revoked: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(userId: string, websiteId: string, apiKeyId: string) {
    await this.assertWebsiteOwnership(userId, websiteId);

    const apiKey = await this.prismaService.apiKey.findFirst({
      where: {
        id: apiKeyId,
        websiteId,
      },
      select: {
        id: true,
        key: true,
        websiteId: true,
        createdAt: true,
        revoked: true,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    if (apiKey.revoked) {
      return apiKey;
    }

    return this.prismaService.apiKey.update({
      where: { id: apiKeyId },
      data: { revoked: true },
      select: {
        id: true,
        key: true,
        websiteId: true,
        createdAt: true,
        revoked: true,
      },
    });
  }

  async update(userId: string, websiteId: string, updateWebsiteDto: UpdateWebsiteDto) {
    const website = await this.prismaService.website.findUnique({
      where: { id: websiteId },
      select: { id: true, userId: true },
    });

    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.userId !== userId) {
      throw new ForbiddenException('You do not have permission to update this website');
    }

    const data: UpdateWebsiteDto = {
      ...updateWebsiteDto,
      ...(updateWebsiteDto.domain
        ? { domain: updateWebsiteDto.domain.toLowerCase() }
        : {}),
    };

    try {
      return await this.prismaService.website.update({
        where: { id: websiteId },
        data,
        select: {
          id: true,
          name: true,
          domain: true,
          userId: true,
          createdAt: true,
        },
      });
    } catch (error) {
      this.handleDomainConflict(error);
      throw error;
    }
  }

  async remove(userId: string, websiteId: string) {
    const website = await this.prismaService.website.findUnique({
      where: { id: websiteId },
      select: { id: true, userId: true },
    });

    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.userId !== userId) {
      throw new ForbiddenException('You do not have permission to delete this website');
    }

    await this.prismaService.website.delete({
      where: { id: websiteId },
    });

    return {
      deleted: true,
      websiteId,
    };
  }

  private handleDomainConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Domain already exists');
    }
  }

  private getUniqueTarget(error: Prisma.PrismaClientKnownRequestError): string[] {
    const target = error.meta?.target;

    if (Array.isArray(target)) {
      return target.map((value) => String(value));
    }

    if (typeof target === 'string') {
      return [target];
    }

    return [];
  }

  private async assertWebsiteOwnership(userId: string, websiteId: string): Promise<void> {
    const website = await this.prismaService.website.findUnique({
      where: { id: websiteId },
      select: { id: true, userId: true },
    });

    if (!website) {
      throw new NotFoundException('Website not found');
    }

    if (website.userId !== userId) {
      throw new ForbiddenException('You do not have permission to access this website');
    }
  }
}
