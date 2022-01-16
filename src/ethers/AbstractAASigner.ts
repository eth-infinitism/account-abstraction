import {BigNumber, BigNumberish, Bytes, Contract, Event, providers, Signer} from "ethers";
import {Provider, TransactionRequest} from "@ethersproject/providers";
import {Deferrable, resolveProperties} from "@ethersproject/properties";
import {EntryPoint, EntryPoint__factory} from "../../typechain-types";
import {BytesLike, hexValue} from "@ethersproject/bytes";
import {TransactionReceipt, TransactionResponse} from "@ethersproject/abstract-provider";
import {fillAndSign, getRequestId} from "../userop/UserOp";
import {UserOperation} from "../userop/UserOperation";
import {clearTimeout} from "timers";
import {localUserOpSender} from "./localUserOpSender";
import {rpcUserOpSender} from "./rpcUserOpSender";

const debug = require('debug')('aasigner')

//if set, then don't use "on(event)"

export type SendUserOp = (userOp: UserOperation) => Promise<TransactionResponse | void>


interface AASignerOptions {

  /**
   * the entry point we're working with.
   */
  entryPointAddress: string

  /**
   *  index of this wallet within the signer. defaults to "zero".
   *use if you want multiple wallets with the same signer.
   */
  index?: number

  /**
   *  URL to send eth_sendUserOperation. if not set, use current provider
   *  (note that current nodes don't support both full RPC and eth_sendUserOperation, so it is required..)
   */
  sendUserOpUrl?: string

  /**
   * underlying RPC provider for read operations. by default, uses signer.provider
   */
  provider?: Provider

  /**
   * Debugging tool:
   * if set, use this signer to call handleOp.
   * This bypasses the RPC call and used for local testing
   */
  debug_handleOpSigner?: Signer
}


/**
 * Abstract base-class for AccountAbstraction signers.
 * Using the signer abstracts away the creation and the usage of the wallet contract.
 * - The underlying Signer object is the owner of this account.
 * - the getAddress() returns the address of the wallet, even before creating it
 * - to fund it, send eth to the address, or call addDeposit
 * - the contract gets created on the first called transaction.
 *
 * see SimpleWalletSigner for an implementation of a specific wallet contract.
 */
export abstract class AbstractAASigner extends Signer {
  static eventsPollingInterval: number | undefined = 2000

  _wallet?: Contract

  private _isPhantom = true
  public entryPoint: EntryPoint

  private _chainId: Promise<number> | undefined

  readonly index: number
  readonly provider: Provider
  readonly sendUserOp: SendUserOp

  /**
   * create account abstraction signer
   * @param signer - the underlying signer. Used only for signing, not for sendTransaction (has no eth)
   * @param options signer options
   */
  constructor(readonly signer: Signer, options: AASignerOptions) {
    super();
    this.index = options.index || 0
    this.provider = options.provider || signer.provider!
    this.entryPoint = EntryPoint__factory.connect(options.entryPointAddress, signer)
    if (this.provider == null) {
      throw new Error('no provider given')
    }
    this.sendUserOp = this._initSendUseOp(this.provider, options)
  }


  _initSendUseOp(provider: Provider, options: AASignerOptions): SendUserOp {
    if (options.debug_handleOpSigner != null) {
      return localUserOpSender(options.entryPointAddress, options.debug_handleOpSigner)
    }
    const rpcProvider = options.sendUserOpUrl != null ?
      new providers.JsonRpcProvider(options.sendUserOpUrl) :
      (provider as providers.JsonRpcProvider)
    if (typeof rpcProvider.send != 'function') {
      throw new Error('not an rpc provider')
    }
    return rpcUserOpSender(rpcProvider)
  }

  /**
   * deposit eth into the entryPoint, to be used for gas payment for this wallet.
   * its cheaper to use deposit (by ~10000gas) rather than use eth from the wallet (and get refunded) on each request.
   *
   * @param wealthySigner some signer with eth to make this transaction.
   * @param amount eth value to deposit.
   */
  async addDeposit(wealthySigner: Signer, amount: BigNumberish) {
    await this.entryPoint.connect(wealthySigner).depositTo(await this.getAddress(), {value: amount})
  }

  /**
   * withdraw deposit.
   * @param withdrawAddress send deposit to this address
   * @param amount amount to withdraw
   */
  async withdrawDeposit(withdrawAddress: string, amount: BigNumberish) {
    // Connect through this provider to withdraw from entrypoint.
    // This generates a UserOperation to call (from our wallet) the entrypoint.withdrawTo
    // (we have to, since only the wallet is allowed to call this method)
    await this.entryPoint.connect(this).withdrawTo(withdrawAddress, amount!)
  }

  /**
   * return current deposit of this wallet.
   */
  async getDeposit(): Promise<BigNumber> {
    return await this.entryPoint.balanceOf(await this.getAddress());
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
    this._wallet = await this._connectWallet(address)
    this._isPhantom = false;
  }

  connect(provider: Provider): Signer {
    throw new Error('connect not implemented')
  }

  /**
   * create deployment transaction.
   * Used to initialize the initCode of a userOp. also determines create2 address of the wallet.
   * NOTE: MUST use the ownerAddress address as part of the init signature.
   */
  abstract _createDeploymentTransaction(entryPointAddress: string, ownerAddress: string): Promise<BytesLike>

  /**
   * create the entryPoint transaction for a given user transaction.
   * @param wallet the wallet object (created with _connectWallet)
   * @param tx
   */
  abstract _createExecFromEntryPoint(wallet: Contract, tx: TransactionRequest): Promise<BytesLike>

  /**
   * return a wallet object connected to this address.
   * The wallet must support the "exec" method (used by "_createExecFromEntryPoint") and "nonce" view method
   * @param address
   */
  abstract _connectWallet(address: any): Promise<Contract>

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

  //unlike real tx, we can't give hash before TX is mined: actual tx depends on
  // other UserOps packed into the same transaction.
  // to make this value meaningful, we need a provider that can do getTransactionReceipt with this virtual
  // value.
  virtualTransactionHash(userOp: UserOperation): string {
    return `userop:${userOp.sender}-${parseInt(userOp.nonce.toString())}`
  }

  //fabricate a response in a format usable by ethers users...
  async userEventResponse(userOp: UserOperation): Promise<TransactionResponse> {
    const entryPoint = this.entryPoint
    const requestId = getRequestId(userOp, entryPoint.address, await this._chainId!)
    const provider = entryPoint.provider
    const currentBLock = provider.getBlockNumber()

    let resolved = false
    const waitPromise = new Promise<TransactionReceipt>((resolve, reject) => {
      let listener = async function (this: any, ...param: any) {
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
        if (event.args.requestId != requestId) {
          console.log(`== event with wrong requestId: sender/nonce: event.${event.args.sender}@${event.args.nonce}!= userOp.${userOp.sender}@${parseInt(userOp.nonce.toString())}`)
          return
        }

        const rcpt = await event.getTransactionReceipt()
        console.log('got event with status=', event.args!.success, 'gasUsed=', rcpt.gasUsed)

        //TODO: should use "requestId" as "transactionId" (but this has to be done in a provider, not a signer)

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
        resolved = true
      }
      listener = listener.bind(listener)
      entryPoint.on('UserOperationEvent', listener)
      //for some reason, 'on' takes at least 2 seconds to be triggered on local network. so add a one-shot timer:
      setTimeout(() => entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(requestId)).then(query => {
        if (query.length > 0) {
          listener(query[0])
        }
      }), 500)
    })
    const resp: TransactionResponse = {
      hash: requestId,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGas), //??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData), // should extract the actual called method from this "execFromSingleton()" call
      chainId: await this._chainId!,
      wait: async function (confirmations?: number): Promise<TransactionReceipt> {
        return waitPromise
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
      const ownerAddress = await this.signer.getAddress();
      const address = await this.entryPoint.getSenderAddress(await this._createDeploymentTransaction(this.entryPoint.address, ownerAddress), this.index)
      this._wallet = await this._connectWallet(address);
    }
    this._chainId = this.provider?.getNetwork().then(net => net.chainId)

    //once an account is deployed, it can no longer be a phantom.
    // but until then, we need to re-check
    if (this._isPhantom) {
      const size = await this.provider!.getCode(this._wallet!.address).then(x => x.length)
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
      const ownerAddress = await this.signer.getAddress();
      initCode = await this._createDeploymentTransaction(this.entryPoint.address, ownerAddress)
    }
    const execFromEntryPoint = await this._createExecFromEntryPoint(this._wallet!, tx)
    if (tx.gasLimit == null) {
      let estimate = await this.provider.estimateGas({
        from: this._wallet!.address,
        to: tx.to,
        value: tx.value,
        data: tx.data
      });
      tx.gasLimit = estimate
    }

    let {gasPrice, maxPriorityFeePerGas, maxFeePerGas} = tx
    //gasPrice is legacy, and overrides eip1559 values:
    if (gasPrice) {
      debug('=== using legacy "gasPrice" instead')
      maxPriorityFeePerGas = gasPrice
      maxFeePerGas = gasPrice
    }
    const userOp = await fillAndSign({
      sender: this._wallet!.address,
      initCode,
      nonce: initCode == null ? tx.nonce : this.index,
      callData: execFromEntryPoint,
      callGas: tx.gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas,
    }, this.signer, this.entryPoint, this._wallet).catch(e => {
      debug('ex=', e);
      throw e
    })

    return userOp
  }
}
