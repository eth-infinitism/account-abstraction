import {ethers} from "ethers";
import {hexValue} from "@ethersproject/bytes";
import {SendUserOp} from "./AASigner";

const debug = require('debug')('aa.userop.rpc')

/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender(provider: ethers.providers.JsonRpcProvider): SendUserOp {

  return async function (userOp) {
    debug('sending', {
      ...userOp,
      initCode: (userOp.initCode ?? '').length,
      callData: (userOp.callData ?? '').length
    })

    //cleanup request: convert all non-hex into hex values.
    const cleanUserOp = Object.keys(userOp).map(key => {
      let val = (userOp as any)[key];
      if (typeof val != 'string' || !val.startsWith('0x'))
        val = hexValue(val)
      return [key, val]
    })
      .reduce((set, [k, v]) => ({...set, [k]: v}), {})
    await provider.send('eth_sendUserOperation', [cleanUserOp])
    //   .catch(e => {
    //   throw new Error(e.error ?? e)
    // })
  }
}