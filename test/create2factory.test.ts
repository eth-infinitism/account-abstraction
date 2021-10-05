import {Create2Factory} from "../src/Create2Factory";
import {ethers} from "hardhat";
import {expect} from "chai";
import {TestToken__factory} from "../typechain";
import {Provider} from "@ethersproject/providers";
import {Signer} from "ethers";

describe('test Create2Factory', () => {
  let factory: Create2Factory
  let provider: Provider
  let signer: Signer
  before(async () => {
    provider = ethers.provider;
    signer = ethers.provider.getSigner()
    factory = new Create2Factory(provider)
  })
  it('should deploy the factory', async () => {
    expect(await factory._isFactoryDeployed()).to.equal(false, 'factory exists before test deploy')
    await factory.deployFactory()
    expect(await factory._isFactoryDeployed()).to.equal(true, 'factory failed to deploy')
  })


  it('should deploy to known address', async () => {
    const initCode = TestToken__factory.bytecode

    const addr = factory.getDeployedAddress(initCode, 0)

    expect(await provider.getCode(addr).then(code => code.length)).to.equal(2)
    await factory.deploy(initCode,0)
    expect(await provider.getCode(addr).then(code => code.length)).to.gt(100)
  })
  it('should deploy to different address based on salt', async () => {
    const initCode = TestToken__factory.bytecode

    const addr = factory.getDeployedAddress(initCode, 123)

    expect(await provider.getCode(addr).then(code => code.length)).to.equal(2)
    await factory.deploy(initCode,123)
    expect(await provider.getCode(addr).then(code => code.length)).to.gt(100)
  })
})