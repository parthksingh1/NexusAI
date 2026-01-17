import { Kafka, type Consumer, type Producer, logLevel } from "kafkajs";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const kafka = new Kafka({
  clientId: config.KAFKA_CLIENT_ID,
  brokers: config.KAFKA_BROKERS.split(","),
  logLevel: logLevel.WARN,
  retry: { retries: 8, initialRetryTime: 300 },
});

let _producer: Producer | null = null;

export async function getProducer(): Promise<Producer> {
  if (_producer) return _producer;
  _producer = kafka.producer({ allowAutoTopicCreation: true, idempotent: true });
  await _producer.connect();
  logger.info("kafka producer connected");
  return _producer;
}

export async function createConsumer(groupId: string): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId, sessionTimeout: 30_000, heartbeatInterval: 3_000 });
  await consumer.connect();
  logger.info({ groupId }, "kafka consumer connected");
  return consumer;
}

export async function disconnectKafka() {
  if (_producer) await _producer.disconnect();
  _producer = null;
}

export async function publish<T>(topic: string, key: string, value: T): Promise<void> {
  const p = await getProducer();
  await p.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }],
  });
}
