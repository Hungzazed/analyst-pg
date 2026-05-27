import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly configService: ConfigService) {}

  health(): string {
    return 'Server is running successfully!!!!!';
  }

  onApplicationBootstrap() {
    this.startPingJob();
  }

  private startPingJob() {
    const appUrl =
      this.configService.get<string>('APP_URL') ||
      `http://localhost:${this.configService.get<string>('PORT') || 3000}`;
    const intervalMinutes = 7;
    const intervalMs = intervalMinutes * 60 * 1000;

    this.logger.log(
      `Starting health ping job to ${appUrl}/health every ${intervalMinutes} minutes.`,
    );

    // Initial ping after 10 seconds to make sure the app is listening
    setTimeout(() => this.ping(appUrl), 10000);

    // Schedule the interval
    setInterval(() => {
      this.ping(appUrl);
    }, intervalMs);
  }

  private async ping(appUrl: string) {
    try {
      const url = `${appUrl}/health`;
      this.logger.log(`Pinging health endpoint: ${url}`);
      const response = await fetch(url);
      if (response.ok) {
        const text = await response.text();
        this.logger.log(`Health check successful: ${text}`);
      } else {
        this.logger.warn(`Health check returned status: ${response.status}`);
      }
    } catch (error) {
      this.logger.error(`Failed to ping health endpoint: ${error.message}`);
    }
  }
}
