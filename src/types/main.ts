/**
 * @rlanz/bus
 *
 * @license MIT
 * @copyright Romain Lanz <romain.lanz@pm.me>
 */

import type { RedisOptions } from 'ioredis'
export type TransportFactory = () => Transport

export interface ManagerConfig<KnownTransports extends Record<string, TransportConfig>> {
  default?: keyof KnownTransports
  transports: KnownTransports
}

export interface TransportConfig {
  driver: TransportFactory
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
}

export type SubscribeHandler<T extends Serializable> = (payload: T) => void | Promise<void>

export type Serializable =
  | string
  | number
  | boolean
  | Serializable[]
  | { [key: string]: Serializable }
