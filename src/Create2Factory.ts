// from https://eips.ethereum.org/EIPS/eip-2470
import { BigNumber, BigNumberish, Contract, ethers, Signer } from 'ethers'
import { arrayify, hexConcat, hexlify, hexZeroPad, keccak256 } from 'ethers/lib/utils'
import { Provider } from '@ethersproject/providers'
import { TransactionRequest } from '@ethersproject/abstract-provider'

export class Create2Factory {
  factoryDeployed = false

  static readonly contractAddress = '0xce0042B868300000d44A59004Da54A005ffdcf9f'
  static readonly factoryDeployer = '0xBb6e024b9cFFACB947A71991E386681B1Cd1477D'
  static readonly factoryTx = '0xf9016c8085174876e8008303c4d88080b90154608060405234801561001057600080fd5b50610134806100206000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80634af63f0214602d575b600080fd5b60cf60048036036040811015604157600080fd5b810190602081018135640100000000811115605b57600080fd5b820183602082011115606c57600080fd5b80359060200191846001830284011164010000000083111715608d57600080fd5b91908080601f016020809104026020016040519081016040528093929190818152602001838380828437600092019190915250929550509135925060eb915050565b604080516001600160a01b039092168252519081900360200190f35b6000818351602085016000f5939250505056fea26469706673582212206b44f8a82cb6b156bfcc3dc6aadd6df4eefd204bc928a4397fd15dacf6d5320564736f6c634300060200331b83247000822470'
  static readonly factoryTxHash = '0x803351deb6d745e91545a6a3e1c0ea3e9a6a02a1a4193b70edfcd2f40f71a01c'
  static readonly factoryDeploymentFee = (0.0247 * 1e18).toString()

  constructor (readonly provider: Provider,
    readonly signer = (provider as ethers.providers.JsonRpcProvider).getSigner()) {
  }

  /**
   * deploy a contract using our EIP-2470 deployer.
   * The delpoyer is deployed (unless it is already deployed)
   * NOTE: this transaction will fail if already deployed. use getDeployedAddress to check it first.
   * @param initCode delpoyment code. can be a hex string or factory.getDeploymentTransaction(..)
   * @param salt specific salt for deployment
   * @param gasLimit gas limit or 'estimate' to use estimateGas. by default, calculate gas based on data size.
   */
  async deploy (initCode: string | TransactionRequest, salt: BigNumberish = 0, gasLimit?: BigNumberish | 'estimate'): Promise<string> {
    await this.deployFactory()
    if (typeof initCode !== 'string') {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      initCode = (initCode as TransactionRequest).data!.toString()
    }

    const addr = this.getDeployedAddress(initCode, salt)
    if (await this.provider.getCode(addr).then(code => code.length) > 2) {
      return addr
    }

    const factory = new Contract(Create2Factory.contractAddress, ['function deploy(bytes _initCode, bytes32 _salt) returns(address)'], this.signer)
    const saltBytes32 = hexZeroPad(hexlify(salt), 32)
    if (gasLimit === 'estimate') {
      gasLimit = await factory.estimateGas.deploy(initCode, saltBytes32)
    }

    // manual estimation (its bit larger: we don't know actual deployed code size)
    if (gasLimit === undefined) {
      gasLimit = arrayify(initCode)
        .map(x => x === 0 ? 4 : 16)
        .reduce((sum, x) => sum + x) +
        200 * initCode.length / 2 + // actual is usually somewhat smaller (only deposited code, not entire constructor)
        6 * Math.ceil(initCode.length / 64) + // hash price. very minor compared to deposit costs
        32000 +
        21000
      // deployer requires some extra gas
      gasLimit = Math.floor(gasLimit * 64 / 63)
    }
    const ret = await factory.deploy(initCode, saltBytes32, { gasLimit })
    await ret.wait()
    return addr
  }

  /**
   * return the deployed address of this code.
   * (the deployed address to be used by deploy()
   * @param initCode
   * @param salt
   */
  getDeployedAddress (initCode: string, salt: BigNumberish): string {
    const saltBytes32 = hexZeroPad(hexlify(salt), 32)
    return '0x' + keccak256(hexConcat([
      '0xff',
      Create2Factory.contractAddress,
      saltBytes32,
      keccak256(initCode)
    ])).slice(-40)
  }

  // deploy the EIP2470 factory, if not already deployed.
  // (note that it requires to have a "signer" with 0.0247 eth, to fund the deployer's deployment
  async deployFactory (signer?: Signer): Promise<void> {
    if (await this._isFactoryDeployed()) {
      return
    }
    await (signer ?? this.signer).sendTransaction({
      to: Create2Factory.factoryDeployer,
      value: BigNumber.from(Create2Factory.factoryDeploymentFee)
    })
    await this.provider.sendTransaction(Create2Factory.factoryTx)
    if (!await this._isFactoryDeployed()) {
      throw new Error('fatal: failed to deploy Eip2470factory')
    }
  }

  async _isFactoryDeployed (): Promise<boolean> {
    if (!this.factoryDeployed) {
      const deployed = await this.provider.getCode(Create2Factory.contractAddress)
      if (deployed.length > 2) {
        this.factoryDeployed = true
      }
    }
    return this.factoryDeployed
  }
}
