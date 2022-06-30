import { Api } from 'zswjs'
import { SignatureProviderArgs, SignatureProvider } from 'zswjs/dist/zswjs-api-interfaces'
import { PushTransactionArgs } from 'zswjs/dist/zswjs-rpc-interfaces'
import { baseTransportManager,  stringToTransportPathPair, TransportPathPair } from './LedgerUtils'
/*
interface SignatureProviderInterface {
  zswjsApi: Api
}
*/
export class LedgerSignatureProvider implements SignatureProvider {
  public zswjsApi: Api = null
  //public ledgerApi: LedgerAPI = null
  public transportPathPairs: TransportPathPair[] = []
  private transportType: string = ""
  constructor(transportPathPairs?: TransportPathPair[] | string[]){
    if(Array.isArray(transportPathPairs) && transportPathPairs.length){
      if(typeof transportPathPairs[0] === 'string'){
        this.transportPathPairs = (transportPathPairs as any).map((x: any)=>stringToTransportPathPair(x))
      }else{
        this.transportPathPairs = transportPathPairs as any;
      }
    }else{
      this.transportPathPairs = [];
    }
  }




  /** Public keys associated with the private keys that the `SignatureProvider` holds */
  public async getAvailableKeys(requestPermission: boolean = false) {
    const keys = [];
    for(let tpp of this.transportPathPairs){
      keys.push(await baseTransportManager.getPublicKeyCached(tpp, requestPermission));
    }
    return keys;
  }

  /** Sign a transaction */
  public async sign({ requiredKeys, chainId, serializedTransaction }: SignatureProviderArgs):Promise<PushTransactionArgs> {
    const availableKeys = await this.getAvailableKeys(false)
    const realReqKeys = requiredKeys.filter(x=>availableKeys.includes(x));

    const signatures: string[] = [];
    for(let rrk of realReqKeys){
      const tpp = await baseTransportManager.getTransportPathPairFromCacheForPublicKey(rrk);
      const newSigs = await baseTransportManager.signTransaction(tpp, {chainId, serializedTransaction});
      newSigs.forEach(ns=>signatures.push(ns));
    }
    return {
      signatures,
      serializedTransaction,
    }
  }

}
