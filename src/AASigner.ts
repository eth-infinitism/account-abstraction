import { BigNumber, Bytes, ethers, Signer, Event } from 'ethers'
import { BaseProvider, Provider, TransactionRequest } from '@ethersproject/providers'
import { Deferrable, resolveProperties } from '@ethersproject/properties'
import { SimpleWallet, SimpleWallet__factory, EntryPoint, EntryPoint__factory } from '../typechain'
import { BytesLike, hexValue } from '@ethersproject/bytes'
import { TransactionResponse } from '@ethersproject/abstract-provider'
import { fillAndSign, getRequestId } from '../test/UserOp'
import { UserOperation } from '../test/UserOperation'
import { TransactionReceipt } from '@ethersproject/abstract-provider/src.ts/index'
import { clearInterval } from 'timers'

export type SendUserOp = (userOp: UserOperation) => Promise<TransactionResponse | undefined>

export const debug = process.env.DEBUG != null

/**
 * send a request using rpc.
 *
 * @param provider - rpc provider that supports "eth_sendUserOperation"
 */
export function rpcUserOpSender (provider: ethers.providers.JsonRpcProvider, entryPointAddress: string): SendUserOp {
  let chainId: number

  return async function (userOp) {
    if (debug) {
      console.log('sending eth_sendUserOperation', {
        ...userOp,
        initCode: (userOp.initCode ?? '').length,
        callData: (userOp.callData ?? '').length
      }, entryPointAddress)
    }
    if (chainId === undefined) {
      chainId = await provider.getNetwork().then(net => net.chainId)
    }

    const cleanUserOp = Object.keys(userOp).map(key => {
      let val = (userOp as any)[key]
      if (typeof val !== 'string' || !val.startsWith('0x')) { val = hexValue(val) }
      return [key, val]
    })
      .reduce((set, [k, v]) => ({ ...set, [k]: v }), {})
    await provider.send('eth_sendUserOperation', [cleanUserOp, entryPointAddress]).catch(e => {
      throw e.error ?? e
    })
    return undefined
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
export function queueUserOpSender (entryPointAddress: string, signer: Signer, intervalMs = 3000): QueueSendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)

  const ret = async function (userOp: UserOperation) {
    if (ret.queue[userOp.sender] == null) {
      ret.queue[userOp.sender] = []
    }
    ret.queue[userOp.sender].push(userOp)
    ret.lastQueueUpdate = Date.now()
    ret.queueSize++
  } as QueueSendUserOp

  ret.queue = {}
  ret.push = async function () {
    await sendQueuedUserOps(ret, entryPoint)
  }
  ret.setInterval = function (intervalMs: number) {
    ret.cancelInterval()
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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

// after that much time with no new TX, send whatever you can.
const IDLE_TIME = 5000

// when reaching this theshold, don't wait anymore and send a bundle
const BUNDLE_SIZE_IMMEDIATE = 3

async function sendQueuedUserOps (queueSender: QueueSendUserOp, entryPoint: EntryPoint): Promise<void> {
  if (sending) {
    console.log('sending in progress. waiting')
    return
  }
  sending = true
  try {
    if (queueSender.queueSize < BUNDLE_SIZE_IMMEDIATE || queueSender.lastQueueUpdate + IDLE_TIME > Date.now()) {
      console.log('queue too small/too young. waiting')
      return
    }
    const ops: UserOperation[] = []
    const queue = queueSender.queue
    Object.keys(queue).forEach(sender => {
      const op = queue[sender].shift()
      if (op != null) {
        ops.push(op)
        queueSender.queueSize--
      }
    })
    if (ops.length === 0) {
      console.log('no ops to send')
      return
    }
    const signer = await (entryPoint.provider as any).getSigner().getAddress()
    console.log('==== sending batch of ', ops.length)
    const ret = await entryPoint.handleOps(ops, signer, { maxPriorityFeePerGas: 2e9 })
    console.log('handleop tx=', ret.hash)
    const rcpt = await ret.wait()
    console.log('events=', rcpt.events!.map(e => ({ name: e.event, args: e.args })))
  } finally {
    sending = false
  }
}

/**
 * send UserOp using handleOps, but locally.
 * for testing: instead of connecting through RPC to a remote host, directly send the transaction
 * @param entryPointAddress the entryPoint address to use.
 * @param signer ethers provider to send the request (must have eth balance to send)
 * @param beneficiary the account to receive the payment (from wallet/paymaster). defaults to the signer's address
 */
export function localUserOpSender (entryPointAddress: string, signer: Signer, beneficiary?: string): SendUserOp {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  return async function (userOp) {
    if (debug) {
      console.log('sending', {
        ...userOp,
        initCode: userOp.initCode.length <= 2 ? userOp.initCode : `<len=${userOp.initCode.length}>`
      })
    }
    const gasLimit = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGas).add(userOp.callGas)
    console.log('calc gaslimit=', gasLimit.toString())
    const ret = await entryPoint.handleOps([userOp], beneficiary ?? await signer.getAddress(), {
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      maxFeePerGas: userOp.maxFeePerGas
    })
    await ret.wait()
    return undefined
  }
}

export class AAProvider extends BaseProvider {
  private readonly entryPoint: EntryPoint

  constructor (entryPointAddress: string, provider: Provider) {
    super(provider.getNetwork())
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

  private _chainId: Promise<number> | undefined

  /**
   * create account abstraction signer
   * @param signer - the underlying signer. has no funds (=can't send TXs)
   * @param entryPoint the entryPoint contract. used for read-only operations
   * @param sendUserOp function to actually send the UserOp to the entryPoint.
   * @param index - index of this wallet for this signer.
   */
  constructor (readonly signer: Signer, readonly entryPointAddress: string, readonly sendUserOp: SendUserOp, readonly index = 0, readonly provider = signer.provider) {
    super()
    this.entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
  }

  // connect to a specific pre-deployed address
  // (note: in order to send transactions, the underlying signer address must be valid signer for this wallet (its owner)
  async connectWalletAddress (address: string): Promise<void> {
    if (this._wallet != null) {
      throw Error('already connected to wallet')
    }
    if (await this.provider!.getCode(address).then(code => code.length) <= 2) {
      throw new Error('cannot connect to non-existing contract')
    }
    this._wallet = SimpleWallet__factory.connect(address, this.signer)
    this._isPhantom = false
  }

  connect (provider: Provider): Signer {
    throw new Error('connect not implemented')
  }

  async _deploymentTransaction (): Promise<BytesLike> {
    const ownerAddress = await this.signer.getAddress()
    return new SimpleWallet__factory()
      .getDeployTransaction(this.entryPoint.address, ownerAddress).data!
  }

  async getAddress (): Promise<string> {
    await this.syncAccount()
    return this._wallet!.address
  }

  async signMessage (message: Bytes | string): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  async signTransaction (transaction: Deferrable<TransactionRequest>): Promise<string> {
    throw new Error('signMessage: unsupported by AA')
  }

  async getWallet (): Promise<SimpleWallet> {
    await this.syncAccount()
    return this._wallet!
  }

  // fabricate a response in a format usable by ethers users...
  async userEventResponse (userOp: UserOperation): Promise<TransactionResponse> {
    const entryPoint = this.entryPoint
    const requestId = getRequestId(userOp, entryPoint.address, await this._chainId!)
    const provider = entryPoint.provider
    const currentBLock = provider.getBlockNumber()

    let resolved = false
    const waitPromise = new Promise<TransactionReceipt>((resolve, reject) => {
      let listener = async function (this: any, ...param: any): Promise<void> {
        if (resolved) return
        const event = arguments[arguments.length - 1] as Event
        if (event.blockNumber <= await currentBLock) {
          // not sure why this callback is called first for previously-mined block..
          console.log('ignore previous block', event.blockNumber)
          return
        }
        if (event.args == null) {
          console.error('got event without args', event)
          return
        }
        if (event.args.requestId !== requestId) {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string
          console.log(`== event with wrong requestId: sender/nonce: event.${event.args.sender}@${event.args.nonce.toString()}!= userOp.${userOp.sender}@${parseInt(userOp.nonce.toString())}`)
          return
        }

        const rcpt = await event.getTransactionReceipt()
        console.log('got event with status=', event.args.success, 'gasUsed=', rcpt.gasUsed)

        // TODO: should use "requestId" as "transactionId" (but this has to be done in a provider, not a signer)

        // before returning the receipt, update the status from the event.
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!event.args.success) {
          console.log('mark tx as failed')
          rcpt.status = 0
          const revertReasonEvents = await entryPoint.queryFilter(entryPoint.filters.UserOperationRevertReason(userOp.sender), rcpt.blockHash)
          // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (revertReasonEvents[0]) {
            console.log('rejecting with reason')
            reject(new Error(`UserOp failed with reason: ${revertReasonEvents[0].args.revertReason}`)
            )
            return
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        entryPoint.off('UserOperationEvent', listener)
        resolve(rcpt)
        resolved = true
      }
      listener = listener.bind(listener)
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      entryPoint.on('UserOperationEvent', listener)
      // for some reason, 'on' takes at least 2 seconds to be triggered on local network. so add a one-shot timer:
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(requestId)).then(query => {
        if (query.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          listener(query[0])
        }
      }), 500)
    })
    const resp: TransactionResponse = {
      hash: requestId,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGas), // ??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData), // should extract the actual called method from this "execFromSingleton()" call
      chainId: await this._chainId!,
      wait: async function (confirmations?: number): Promise<TransactionReceipt> {
        return await waitPromise
      }
    }
    return resp
  }

  async sendTransaction (transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
    const userOp = await this._createUserOperation(transaction)
    // get response BEFORE sending request: the response waits for events, which might be triggered before the actual send returns.
    const reponse = await this.userEventResponse(userOp)
    await this.sendUserOp(userOp)
    return reponse
  }

  async syncAccount (): Promise<void> {
    if (this._wallet == null) {
      const address = await this.entryPoint.getSenderAddress(await this._deploymentTransaction(), this.index)
      this._wallet = SimpleWallet__factory.connect(address, this.signer)
    }

    this._chainId = this.provider?.getNetwork().then(net => net.chainId)
    // once an account is deployed, it can no longer be a phantom.
    // but until then, we need to re-check
    if (this._isPhantom) {
      const size = await this.signer.provider?.getCode(this._wallet.address).then(x => x.length)
      // console.log(`== __isPhantom. addr=${this._wallet.address} re-checking code size. result = `, size)
      this._isPhantom = size === 2
      // !await this.entryPoint.isContractDeployed(await this.getAddress());
    }
  }

  // return true if wallet not yet created.
  async isPhantom (): Promise<boolean> {
    await this.syncAccount()
    return this._isPhantom
  }

  async _createUserOperation (transaction: Deferrable<TransactionRequest>): Promise<UserOperation> {
    const tx: TransactionRequest = await resolveProperties(transaction)
    await this.syncAccount()

    let initCode: BytesLike | undefined
    if (this._isPhantom) {
      initCode = await this._deploymentTransaction()
    }
    const execFromEntryPoint = await this._wallet!.populateTransaction.execFromEntryPoint(tx.to!, tx.value ?? 0, tx.data!)

    let { gasPrice, maxPriorityFeePerGas, maxFeePerGas } = tx
    // gasPrice is legacy, and overrides eip1559 values:
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
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
      maxFeePerGas
    }, this.signer, this.entryPoint)

    return userOp
  }
}
