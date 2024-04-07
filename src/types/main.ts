/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import type { RedisOptions } from 'ioredis'
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

export interface RedisTransportConfig extends RedisOptions {}

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
  decode: <T>(data: string) => { busId: string; payload: T }
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
