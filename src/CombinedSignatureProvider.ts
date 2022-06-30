import { SignatureProvider, SignatureProviderArgs } from "zswjs/dist/zswjs-api-interfaces";
import { PushTransactionArgs } from "zswjs/dist/zswjs-rpc-interfaces";

export class CombinedSignatureProvider implements SignatureProvider {
  private providers: SignatureProvider[] = [];



  constructor(providers?: SignatureProvider[]){
    this.setProviders(Array.isArray(providers) ? providers.concat([]) : []);
  }
  setProviders(providers: SignatureProvider[]){
    this.providers = providers.concat([]);
  }
  addProvider(provider: SignatureProvider){
    this.providers.push(provider);
  }
  async getAvailableKeys(): Promise<string[]> {
    let keys: string[] = [];
    for(let provider of this.providers){
      keys = keys.concat(await provider.getAvailableKeys());
    }
    return keys;
  }
  /** Sign a transaction */
  async sign(args: SignatureProviderArgs): Promise<PushTransactionArgs> {
    const pubKeyMap : {[key: string]: number}= {};

    const providers = this.providers.concat([]);
    const providerKeysById = await Promise.all(providers.map(x=>x.getAvailableKeys()));
    providerKeysById.forEach((x, ind)=>{
      x.forEach(k=>pubKeyMap[k]= ind);
    });
    const requiredByProvider = providers.map(()=>[]);
    for(let rk of args.requiredKeys){
      if(pubKeyMap.hasOwnProperty(rk) && typeof pubKeyMap[rk] === 'number'){
        requiredByProvider[pubKeyMap[rk]].push(rk);
      }
    }
    let signatures : string[] = [];

    for(let i=0;i<requiredByProvider.length;i++){
      if(requiredByProvider[i].length){
        signatures = signatures.concat((await providers[i].sign({...args, requiredKeys: requiredByProvider[i]})).signatures);
      }
    }

    return {
      signatures: signatures,
      serializedTransaction: args.serializedTransaction,
      serializedContextFreeData: args.serializedContextFreeData,
    };
  }

}