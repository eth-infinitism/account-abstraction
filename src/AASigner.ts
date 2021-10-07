import {BigNumber, Bytes, Contract, ethers, Signer} from "ethers";
import {BaseProvider, Provider, TransactionRequest} from "@ethersproject/providers";
import {Event} from 'ethers'
import {Deferrable, resolveProperties} from "@ethersproject/properties";
import {SimpleWallet, SimpleWallet__factory, EntryPoint, EntryPoint__factory} from "../typechain";
import {BytesLike, hexValue} from "@ethersproject/bytes";
import {TransactionResponse} from "@ethersproject/abstract-provider";
import {fillAndSign} from "../test/UserOp";
import {UserOperation} from "../test/UserOperation";
import {TransactionReceipt} from "@ethersproject/abstract-provider/src.ts/index";
import {clearInterval} from "timers";
import {use} from "chai";
//import axios from 'axios'

const axios: any = {}
export type SendUserOp = (userOp: UserOperation) => Promise<TransactionResponse | void>

export let debug = false

/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender(provider: ethers.providers.JsonRpcProvider): SendUserOp {

  let chainId: number

  return async function (userOp) {
    if (debug) {
      console.log('sending', {
        ...userOp,
        initCode: (userOp.initCode ?? '').length,
        callData: (userOp.callData ?? '').length
      })
    }
    if (chainId == undefined) {
      chainId = await provider.getNetwork().then(net => net.chainId)
    }

    const cleanUserOp = Object.keys(userOp).map(key => {
      let val = (userOp as any)[key];
      if (typeof val != 'string' || !val.startsWith('0x'))
        val = hexValue(val)
      return [key, val]
    })
      .reduce((set, [k, v]) => ({...set, [k]: v}), {})
    await provider.send('eth_sendUserOperation', [cleanUserOp]).catch(e => {
      throw e.error ?? e
    })
  }
}


interface QueueSendUserOp extends SendUserOp {
  lastQueueUpdate: number
  queueSize: number
  queue: { [sender: string]: UserOperation[] }
  push: () => Promise<void>
  setInterval: (intervalMs: number) => void
  cancelInterval: () => void

  _cancelInterval: any
}

/**
 * a SendUserOp that queue requests. need to call sendQueuedUserOps to create a bundle and send them.
 * the returned object handles the queue of userops and also interval control.
 */
export function queueUserOpSender(entryPointAddress: string, signer: Signer, intervalMs = 3000): QueueSendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)

  let ret = <QueueSendUserOp>async function (userOp: UserOperation) {
    if (ret.queue[userOp.sender] == null) {
      ret.queue[userOp.sender] = []
    }
    ret.queue[userOp.sender].push(userOp)
    ret.lastQueueUpdate = Date.now()
    ret.queueSize++
  }

  ret.queue = {}
  ret.push = async function () {
    await sendQueuedUserOps(ret, entryPoint)
  }
  ret.setInterval = function (intervalMs: number) {
    ret.cancelInterval()
    ret._cancelInterval = setInterval(ret.push, intervalMs)
  }
  ret.cancelInterval = function () {
    if (ret._cancelInterval != null) {
      clearInterval(ret._cancelInterval)
      ret._cancelInterval = null
    }
  }

  if (intervalMs != null) {
    ret.setInterval(intervalMs)
  }

  return ret
}

/**
 * create a bundle from the queue and send it to the entrypoint.
 * NOTE: only a single request from a given sender can be put into a bundle.
 * @param queue
 * @param entryPoint
 */

let sending = false

//after that much time with no new TX, send whatever you can.
const IDLE_TIME = 5000

//when reaching this theshold, don't wait anymore and send a bundle
const BUNDLE_SIZE_IMMEDIATE = 3

async function sendQueuedUserOps(queueSender: QueueSendUserOp, entryPoint: EntryPoint) {
  if (sending) {
    console.log('sending in progress. waiting')
    return
  }
  sending = true;
  try {
    if (queueSender.queueSize < BUNDLE_SIZE_IMMEDIATE || queueSender.lastQueueUpdate + IDLE_TIME > Date.now()) {
      console.log('queue too small/too young. waiting')
      return
    }
    let ops: UserOperation[] = []
    const queue = queueSender.queue
    Object.keys(queue).forEach(sender => {
      let op = queue[sender].shift();
      if (op != null) {
        ops.push(op)
        queueSender.queueSize--
      }
    })
    if (ops.length == 0) {
      console.log('no ops to send')
      return
    }
    let signer = await (entryPoint.provider as any).getSigner().getAddress();
    console.log('==== sending batch of ', ops.length)
    const ret = await entryPoint.handleOps(ops, signer, {maxPriorityFeePerGas: 2e9})
    console.log('handleop tx=', ret.hash)
    const rcpt = await ret.wait()
    console.log('events=', rcpt.events!.map(e => ({name: e.event, args: e.args})))
  } finally {
    sending = false
  }
}

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
    const ret = await entryPoint.handleOps([userOp], redeemer ?? await signer.getAddress(), {
      gasLimit: 10e6,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      maxFeePerGas: userOp.maxFeePerGas
    })
    const rcpt = await ret.wait()
  }
}


export class AAProvider extends BaseProvider {
  private entryPoint: EntryPoint;

  constructor(entryPointAddress: string, provider: Provider) {
    super(provider.getNetwork());
    this.entryPoint = EntryPoint__factory.connect(entryPointAddress, provider)
  }

}

/**
 * a signer that wraps account-abstraction.
 */
export class AASigner extends Signer {
  _wallet?: SimpleWallet

  private _isPhantom = true
  public entryPoint: EntryPoint

  //TODO: if needed, then async'ly initialize from provider.
  private _chainId = 0

  /**
   * create account abstraction signer
   * @param signer - the underlying signer. has no funds (=can't send TXs)
   * @param entryPoint the entryPoint contract. used for read-only operations
   * @param sendUserOp function to actually send the UserOp to the entryPoint.
   * @param index - index of this wallet for this signer.
   */
  constructor(readonly signer: Signer, readonly entryPointAddress: string, readonly sendUserOp: SendUserOp, readonly index = 0, readonly provider = signer.provider) {
    super();
    this.entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  }

  //connect to a specific pre-deployed address
  // (note: in order to send transactions, the underlying signer address must be valid signer for this wallet (its owner)
  async connectWalletAddress(address: string) {
    if (this._wallet != null) {
      throw Error('already connected to wallet')
    }
    if (await this.provider!.getCode(address).then(code => code.length) <= 2) {
      throw new Error('cannot connect to non-existing contract')
    }
    this._wallet = SimpleWallet__factory.connect(address, this.signer)
    this._isPhantom = false;
  }

  connect(provider: Provider): Signer {
    throw new Error('connect not implemented')
  }

  async _deploymentTransaction(): Promise<BytesLike> {
    let ownerAddress = await this.signer.getAddress();
    return new SimpleWallet__factory()
      .getDeployTransaction(this.entryPoint.address, ownerAddress).data!
  }

  async getAddress(): Promise<string> {
    await this.syncAccount()
    return this._wallet!.address
  }

  signMessage(message: Bytes | string): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  signTransaction(transaction: Deferrable<TransactionRequest>): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  async getWallet(): Promise<SimpleWallet> {

    await this.syncAccount()
    return this._wallet!
  }

  //fabricate a response in a format usable by ethers users...
  async userEventResponse(userOp: UserOperation): Promise<TransactionResponse> {
    const entryPoint = this.entryPoint
    const provider = entryPoint.provider
    const resp: TransactionResponse = {
      hash: `userop:${userOp.sender}-${userOp.nonce}`,  //unlike real tx, we can't give hash before TX is mined
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGas), //??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData),
      chainId: this._chainId,
      wait: async function (confirmations?: number): Promise<TransactionReceipt> {
        return new Promise<TransactionReceipt>((resolve, reject) => {
          let listener = async function (this: any) {
            const event = arguments[arguments.length - 1] as Event
            if (event.args!.nonce != parseInt(userOp.nonce.toString())) {
              console.log(`== event with wrong nonce: event.${event.args!.nonce}!= userOp.${userOp.nonce}`)
              return
            }

            const rcpt = await event.getTransactionReceipt()
            console.log('got event with status=', event.args!.success, 'gasUsed=', rcpt.gasUsed)

            //before returning the receipt, update the status from the event.
            if (!event.args!.success) {
              console.log('mark tx as failed')
              rcpt.status = 0
              const revertReasonEvents = await entryPoint.queryFilter(entryPoint.filters.UserOperationRevertReason(userOp.sender), rcpt.blockHash)
              if (revertReasonEvents[0]) {
                console.log('rejecting with reason')
                reject('UserOp failed with reason: ' +
                  revertReasonEvents[0].args.revertReason)
                return
              }
            }
            entryPoint.off('UserOperationEvent', listener)
            resolve(rcpt)
          }
          listener = listener.bind(listener)
          entryPoint.on('UserOperationEvent', listener)
        })
      }
    }
    return resp
  }

  async sendTransaction(transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {

    const userOp = await this._createUserOperation(transaction)
    //get response BEFORE sending request: the response waits for events, which might be triggered before the actual send returns.
    let reponse = await this.userEventResponse(userOp);
    await this.sendUserOp(userOp)
    return reponse
  }

  async syncAccount() {
    if (!this._wallet) {
      const address = await this.entryPoint.getSenderAddress(await this._deploymentTransaction(), this.index)
      this._wallet = SimpleWallet__factory.connect(address, this.signer)
    }

    //once an account is deployed, it can no longer be a phantom.
    // but until then, we need to re-check
    if (this._isPhantom) {
      const size = await this.signer.provider?.getCode(this._wallet.address).then(x => x.length)
      // console.log(`== __isPhantom. addr=${this._wallet.address} re-checking code size. result = `, size)
      this._isPhantom = size == 2
      // !await this.entryPoint.isContractDeployed(await this.getAddress());
    }
  }

  //return true if wallet not yet created.
  async isPhantom(): Promise<boolean> {
    await this.syncAccount()
    return this._isPhantom
  }

  async _createUserOperation(transaction: Deferrable<TransactionRequest>): Promise<UserOperation> {

    const tx: TransactionRequest = await resolveProperties(transaction)
    await this.syncAccount()

    let initCode: BytesLike | undefined
    if (this._isPhantom) {
      initCode = await this._deploymentTransaction()
    }
    const execFromEntryPoint = await this._wallet!.populateTransaction.execFromEntryPoint(tx.to!, tx.value ?? 0, tx.data!)

    let {gasPrice, maxPriorityFeePerGas, maxFeePerGas} = tx
    //gasPrice is legacy, and overrides eip1559 values:
    if (gasPrice) {
      maxPriorityFeePerGas = gasPrice
      maxFeePerGas = gasPrice
    }
    const userOp = await fillAndSign({
      sender: this._wallet!.address,
      initCode,
      nonce: initCode == null ? tx.nonce : this.index,
      callData: execFromEntryPoint.data!,
      callGas: tx.gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas,
    }, this.signer, this.entryPoint)

    return userOp
  }
}
