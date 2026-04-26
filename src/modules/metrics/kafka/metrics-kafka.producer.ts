import { Injectable } from '@nestjs/common';
import { KafkaService } from '../../../infrastructure';
import { MetricsEventMessage } from './metrics-event-message';

const METRICS_EVENTS_TOPIC = 'metrics.events';

@Injectable()
export class MetricsKafkaProducer {
  constructor(private readonly kafkaService: KafkaService) {}

  async enqueue(message: MetricsEventMessage): Promise<void> {
    await this.kafkaService.send({
      topic: METRICS_EVENTS_TOPIC,
      messages: [
        {
          key: message.websiteId,
          value: JSON.stringify(message),
        },
      ],
    });
  }
}
