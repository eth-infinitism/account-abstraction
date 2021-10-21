import {Signer} from "ethers";
import {debug, SendUserOp} from "./AASigner";
import {EntryPoint__factory} from "../../typechain";

/**
 * send UserOp using handleOps, but locally.
 * for testing: instead of connecting through RPC to a remote host, directly send the transaction
 * @param entryPointAddress the entryPoint address to use.
 * @param signer ethers provider to send the request (must have eth balance to send)
 * @param redeemer the account to receive the payment (from wallet/paymaster). defaults to the signer's address
 */
export function localUserOpSender(entryPointAddress: string, signer: Signer, redeemer?: string): SendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  return async function (userOp) {
    if (debug)
      console.log('sending', {
        ...userOp,
        initCode: (userOp.initCode ?? '').length,
        callData: (userOp.callData ?? '').length
      })
    try {
      const ret = await entryPoint.handleOps([userOp], redeemer ?? await signer.getAddress(), {
        gasLimit: 10e6,
        maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
        maxFeePerGas: userOp.maxFeePerGas
      })
      const rcpt = await ret.wait()
    } catch (e) {
      if(debug) {
        console.log('==sending ex=', e)
      }
      throw e
    }
  }
}