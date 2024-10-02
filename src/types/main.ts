/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright Boring Node
 */

import type { RedisOptions } from 'ioredis'
import type { IClientOptions } from 'mqtt'
export type TransportFactory = () => Transport

/**
 * A Duration can be a number in milliseconds or a string formatted as a duration
 *
 * Formats accepted are :
 * - Simple number in milliseconds
 * - String formatted as a duration. Uses https://github.com/lukeed/ms under the hood
 */
export type Duration = number | string

export interface ManagerConfig<KnownTransports extends Record<string, TransportConfig>> {
  default?: keyof KnownTransports
  transports: KnownTransports
}

export interface TransportConfig {
  transport: TransportFactory
  retryQueue?: RetryQueueOptions
}

export interface RedisTransportConfig extends RedisOptions {
  /**
   * If true, we will use `messageBuffer` event instead of `message` event
   * that is emitted by ioredis. `messageBuffer` will returns a buffer instead
   * of a string and this is useful when you are dealing with binary data.
   */
  useMessageBuffer?: boolean
}

export enum MqttProtocol {
  MQTT = 'mqtt',
  MQTTS = 'mqtts',
  TCP = 'tcp',
  TLS = 'tls',
  WS = 'ws',
  WSS = 'wss',
  WXS = 'wxs',
  ALIS = 'alis',
}

export interface MqttTransportConfig {
  host: string
  port?: number
  protocol?: MqttProtocol
  options?: IClientOptions
}

export interface Transport {
  setId: (id: string) => Transport
  onReconnect: (callback: () => void) => void
  publish: (channel: string, message: Serializable) => Promise<void>
  subscribe: <T extends Serializable>(
    channel: string,
    handler: SubscribeHandler<T>
  ) => Promise<void>
  unsubscribe: (channel: string) => Promise<void>
  disconnect: () => Promise<void>
}

export interface TransportMessage<T extends Serializable = any> {
  busId: string
  payload: T
}

export interface TransportEncoder {
  encode: (message: TransportMessage) => string | Buffer
  decode: <T>(data: string | Buffer) => { busId: string; payload: T }
}

export interface RetryQueueOptions {
  enabled?: boolean
  removeDuplicates?: boolean
  maxSize?: number | null
  retryInterval?: Duration | false
}

export type SubscribeHandler<T extends Serializable> = (payload: T) => void | Promise<void>

export type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable }
