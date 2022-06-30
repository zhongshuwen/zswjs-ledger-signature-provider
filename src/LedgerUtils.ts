import Transport from '@ledgerhq/hw-transport'
import { Api, JsonRpc, Serialize } from 'zswjs'
import { JsSignatureProvider } from 'zswjs/dist/zswjs-jssig'

import ecc from 'zsw-crypto'

import asn1 from 'asn1-ber'
import Buff from 'buffer/'
import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble'
import bippath from 'bip32-path'
declare const TextDecoder: any
declare const TextEncoder: any

export enum LEDGER_CODES {
  CLA = 0xD4,
  INS_GET_PUBLIC_KEY = 0x02,
  INS_SIGN = 0x04,
  INS_GET_APP_CONFIGURATION = 0x06,
  P1_CONFIRM = 0x01,
  P1_NON_CONFIRM = 0x00,
  P1_FIRST = 0x00,
  P1_MORE = 0x80,
}

export interface TransportPathPair {
  transportType: TransportType;
  path: string;
}
export function transportPathPairToString(tpp: TransportPathPair){
  return tpp.transportType+":"+tpp.path;
}
export function convertShortHandPaths(s: string){
  if(s.indexOf("/")===-1 && parseInt(s, 10).toString() === s){
    return GET_LEDGER_PATHS(parseInt(s, 10));
  }else{
    return s;
  }
}
export function stringToTransportPathPair(str: string): TransportPathPair{
  const ind = str.indexOf(":");
  if(ind !== -1){
    return {
      transportType: str.substring(0, ind) as any,
      path: convertShortHandPaths(str.substring(ind+1)),
    }
  }else{
    throw new Error("Invalid transport path pair string!")
  }

}
export const GET_LEDGER_PATHS =  (index = 0) => `44'/194'/0'/0/${index}`
export type TransportCacheMap = {
  bluetooth?: Transport,
  usb?: Transport,
};
export type TransportType = keyof TransportCacheMap;
class TransportManager {
  
  public transportMap: TransportCacheMap = {};
  public publicKeyMap: {[type: string]:any};
  constructor(){

  }
  async getTransport(transportType: keyof TransportCacheMap, timeout = 60000): Promise<Transport>{
    if(this.transportMap.hasOwnProperty(transportType)&&this.transportMap[transportType]){
      return this.transportMap[transportType];
    }else{
      const _this = this;
      if(transportType === "usb"){
        const transport = await TransportWebUSB.create(timeout)
        this.transportMap.usb = transport;
        transport.on("disconnect",()=>{
          _this.clearPublicKeyCacheForTransportType("usb");
          delete _this.transportMap.usb;
        })
        return transport;
      }else if(transportType === "bluetooth"){
        const transport = await BluetoothTransport.create(timeout)
        this.transportMap.bluetooth = transport;
        transport.on("disconnect",()=>{
          _this.clearPublicKeyCacheForTransportType("bluetooth");
          delete _this.transportMap.bluetooth;
        })
        return transport;
      }else{
        throw new Error("Unknown transport type!")
      }
    }

  }
  clearPublicKeyCacheForTransportType(transportType: TransportType){
    Object.keys(this.publicKeyMap).filter(k=>stringToTransportPathPair(k).transportType === transportType).forEach(k=>{
      delete this.publicKeyMap[k];
    });

  }
  async getTransportPathPairFromCacheForPublicKey(publicKey: string): Promise<TransportPathPair | null> {
    const keys = Object.keys(this.publicKeyMap);
    for(let k of keys){
      if(this.publicKeyMap[k] === publicKey){
        return stringToTransportPathPair(k);
      }
    }
    return null;
  }
  async getPublicKeyCached(tpp: TransportPathPair, requestPermission = true): Promise<string>{
    const key = transportPathPairToString(tpp);
    if(this.publicKeyMap.hasOwnProperty(key) && this.publicKeyMap[key]){
      return this.publicKeyMap[key];
    }
    const pk = await this.getPublicKey(tpp, requestPermission);
    this.publicKeyMap[key] = pk;
    return pk;
  }

  async getPublicKey(tpp: TransportPathPair, requestPermission = true, getTransportTimeout = 60000): Promise<string>{
    const transport = await this.getTransport(tpp.transportType, getTransportTimeout);
    
    return await (new Promise((resolve, reject) => {
      setTimeout(() => {
        //const path = GET_LEDGER_PATHS(this.publicKeyIndex)
        const paths = bippath.fromString(tpp.path).toPathArray()
        const buffer = Buff.Buffer.alloc(1 + paths.length * 4)
        buffer[0] = paths.length
        paths.forEach((element: number, index: number) => {
          buffer.writeUInt32BE(element, 1 + 4 * index)
        })

        return transport
          .send(
            LEDGER_CODES.CLA,
            LEDGER_CODES.INS_GET_PUBLIC_KEY,
            requestPermission ? LEDGER_CODES.P1_CONFIRM : LEDGER_CODES.P1_NON_CONFIRM,
            LEDGER_CODES.P1_NON_CONFIRM,
            buffer as any
          )
          .then((response: any) => {

            const publicKeyLength = response[0]
            const addressLength = response[1 + publicKeyLength]

            resolve(response
              .slice(
                1 + publicKeyLength + 1,
                1 + publicKeyLength + 1 + addressLength
              )
              .toString('ascii'))
          }).catch((err: Error) => {
            reject(err)
          })
      }, 1)
    }));
  }

  /**
   * @returns A Signed ZSW transaction
   */
   public async signTransaction(
    tpp: TransportPathPair,
    { chainId, serializedTransaction }: { chainId: string, serializedTransaction: Uint8Array }
    ) {
    //const path = GET_LEDGER_PATHS(this.publicKeyIndex)
    const transport = await this.getTransport(tpp.transportType, 60000*5);

    const paths = bippath.fromString(tpp.path).toPathArray()
    let offset = 0
    let transactionBuffer

    try {
      transactionBuffer = serialize(chainId, serializedTransaction).toString('hex')
    } catch (error) {
      console.error(error)
      throw new Error('Unable to deserialize transaction')
    }

    const rawTx = Buff.Buffer.from(transactionBuffer, 'hex')
    const toSend = []
    let response: any
    while (offset !== rawTx.length) {
      const maxChunkSize = offset === 0 ? 150 - 1 - paths.length * 4 : 150
      const chunkSize =
        offset + maxChunkSize > rawTx.length
          ? rawTx.length - offset
          : maxChunkSize
      const buffer = Buff.Buffer.alloc(
        offset === 0 ? 1 + paths.length * 4 + chunkSize : chunkSize
      )
      if (offset === 0) {
        buffer[0] = paths.length
        paths.forEach((element: number, index: number) => {
          buffer.writeUInt32BE(element, 1 + 4 * index)
        })
        rawTx.copy(buffer, 1 + 4 * paths.length, offset, offset + chunkSize)
      } else {
        rawTx.copy(buffer, 0, offset, offset + chunkSize)
      }
      toSend.push(buffer)
      offset += chunkSize
    }

    return iteratePromises(toSend, (data: any[], i: number) =>
      transport
        .send(
          LEDGER_CODES.CLA,
          LEDGER_CODES.INS_SIGN,
          i === 0 ? LEDGER_CODES.P1_FIRST : LEDGER_CODES.P1_MORE,
          LEDGER_CODES.P1_NON_CONFIRM,
          data as any,
         )
        .then((apduResponse: any) => {
          response = apduResponse
          return response
        })
      ).then(() => {
        const v = response.slice(0, 1).toString('hex')
        const r = response.slice(1, 1 + 32).toString('hex')
        const s = response.slice(1 + 32, 1 + 32 + 32).toString('hex')
        return convertSignatures(v + r + s)
      }).catch((error) => {
        console.error(error)
        throw error
      })
  }
}
export const baseTransportManager = new TransportManager();


export const convertSignatures = (sigs: string[]): string[] => {
  if (!Array.isArray(sigs)) {
    sigs = [sigs]
  }

  sigs = [].concat.apply([], sigs)

  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i]
    if (typeof sig === 'string' && sig.length === 130) {
      sigs[i] = ecc.Signature.from(sig).toString()
    }
  }

  return sigs
}

export const iteratePromises = (arr: any[], callback: (x: any[], i: number) => Promise<any>) => {
  const iterate = (index: number, array: any[], result: any): any => {
    if (index >= array.length) {
      return result
    }
    return callback(array[index], index)
      .then((res) => {
        result.push(res)
        return iterate(index + 1, array, result)
      })
  }

  return Promise.resolve().then(() => iterate(0, arr, []))
}

export const serialize = (chainId: string, serializedTransaction: Uint8Array) => {
  const api = new Api({ rpc: new JsonRpc(''), signatureProvider: new JsSignatureProvider([]) })
  const transaction = api.deserializeTransaction(serializedTransaction)
  const writer = new asn1.BerWriter()

  encode(writer, createNewBuffer(api, 'checksum256', chainId))
  encode(writer, createNewBuffer(api, 'time_point_sec', transaction.expiration))
  encode(writer, createNewBuffer(api, 'uint16', transaction.ref_block_num))
  encode(writer, createNewBuffer(api, 'uint32', transaction.ref_block_prefix))
  encode(writer, createNewBuffer(api, 'varuint32', 0)) // max_net_usage_words
  encode(writer, createNewBuffer(api, 'uint8', transaction.max_cpu_usage_ms))
  encode(writer, createNewBuffer(api, 'varuint32', transaction.delay_sec))

  encode(writer, createNewBuffer(api, 'uint8', 0)) // ctx_free_actions_size

  encode(writer, createNewBuffer(api, 'uint8', transaction.actions.length))
  for (const action of transaction.actions) {
    encode(writer, createNewBuffer(api, 'name', action.account))
    encode(writer, createNewBuffer(api, 'name', action.name))
    encode(writer, createNewBuffer(api, 'uint8', action.authorization.length))

    for (const authorization of action.authorization) {
      encode(writer, createNewBuffer(api, 'name', authorization.actor))
      encode(writer, createNewBuffer(api, 'name', authorization.permission))
    }

    const actionData = Buff.Buffer.from(action.data, 'hex')
    encode(writer, createNewBuffer(api, 'uint8', actionData.length))

    const actionDataBuffer = new Serialize.SerialBuffer({
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
    })
    actionDataBuffer.pushArray(actionData)
    encode(writer, actionDataBuffer.asUint8Array())
  }

  encode(writer, createNewBuffer(api, 'uint8', 0)) // transaction_extensions
  encode(writer, createNewBuffer(api, 'checksum256', Buff.Buffer.alloc(32, 0).toString('hex'))) // ctx_free_data

  return writer.buffer
}

const createNewBuffer = (api: Api, type: string, data: any) => {
  const buffer = new Serialize.SerialBuffer({ textDecoder: new TextDecoder(), textEncoder: new TextEncoder() })

  api.serialize(buffer, type, data)
  return buffer.asUint8Array()
}

const encode = (writer: any , buffer: Uint8Array) => {
  writer.writeBuffer(Buff.Buffer.from(buffer), asn1.Ber.OctetString)
}
