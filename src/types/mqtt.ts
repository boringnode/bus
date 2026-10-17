/**
 * @boringnode/bus
 *
 * @license MIT
 * @copyright BoringNode
 */

import type { IClientOptions } from 'mqtt'

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
