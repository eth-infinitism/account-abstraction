import {ethers} from "ethers";
import {SendUserOp} from "./AbstractAASigner";
import {hexValues} from "../userop/utils";

const debug = require('debug')('aa.userop.rpc')

/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender(provider: ethers.providers.JsonRpcProvider, entryPointAddress: string): SendUserOp {

  return async function (userOp) {
    debug('sending', {
      ...userOp,
      initCode: (userOp.initCode ?? '').length,
      callData: (userOp.callData ?? '').length
    })
    //cleanup request: convert all non-hex into hex values.
    const cleanUserOp = { ...hexValues(userOp), sender: userOp.sender, paymaster: userOp.paymaster }
    await provider.send('eth_sendUserOperation', [cleanUserOp, entryPointAddress])
    //   .catch(e => {
    //   throw new Error(e.error ?? e)
    // })
  }
}