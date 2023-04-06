import { Wallet, Signer } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { parseEther } from 'ethers/lib/utils'
import {
  TSPAccountFactory__factory,
  Guardian__factory,
  TestToken,
  TestToken__factory
  // TestUtil,
  // TestUtil__factory,
} from '../typechain'
import { DefaultDelayBlock, createAccountOwner, ONE_ETH, createTSPAccount } from './tsp-utils.test'

describe('TSPAccount', function () {
  let accounts: string[]
  let token: TestToken
  const signer = ethers.provider.getSigner()
  let accountOwner: Wallet
  let operator: Signer
  let newOperator: Signer
  let newOperator2: Signer
  let g1: Signer
  let g2: Signer
  let g3: Signer
  let newOwner: Wallet
  let newOwner2: Wallet
  before(async function () {
    accounts = await ethers.provider.listAccounts()
    token = await new TestToken__factory(signer).deploy()
    g1 = await ethers.getSigner(accounts[1])
    g2 = await ethers.getSigner(accounts[2])
    g3 = await ethers.getSigner(accounts[3])
    operator = await ethers.getSigner(accounts[5])
    newOperator = await ethers.getSigner(accounts[6])
    newOperator2 = await ethers.getSigner(accounts[7])
    // mint 10000 tokens
    await token.mint(signer.getAddress(), ethers.utils.parseEther('10000'))
    console.log(await token.balanceOf(signer.getAddress()))
  })
  it('normal process', async () => {
    // 1.deploy guardian contract
    const _guardian = await new Guardian__factory(signer).deploy()
    const guardian = Guardian__factory.connect(_guardian.address, signer)
    const entryPoint = '0x'.padEnd(42, '2')
    // 2.deploy tsp_account factory contract
    const factory = await new TSPAccountFactory__factory(signer).deploy(entryPoint)
    // 3.create EOA address
    accountOwner = createAccountOwner()
    await signer.sendTransaction({ from: accounts[0], to: accountOwner.address, value: parseEther('1').toString() })
    // 4.create account
    const { proxy: account } = await createTSPAccount(signer, accountOwner.address, entryPoint, guardian, factory)
    // const account = TSPAccount__factory.connect(accountOwner.address, signer)
    // 5.register this account in the guardian contract
    // await guardian.register(account.address, { gasLimit: 10000000 })
    await account.connect(accountOwner).changeGuardian(guardian.address, { gasLimit: 10000000 })
    // 6.set guardians and threshold values and block delay in the guardians contract
    // await guardian.setConfig(accountOwner.address, { guardians: accounts.slice(1, 3), approveThreshold: DefaultThreshold, delay: DefaultDelayBlock }, { gasLimit: 10000000 })
    // 7.recharging 10 ETHs in account
    console.log('accountowner', accountOwner.address, 'account address', account.address)
    await signer.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('5').toString() })
    expect(await ethers.provider.getBalance(account.address)).to.be.equal(parseEther('5').toString())
    // 8.recharging 1000 USDTs in account
    await token.transfer(account.address, parseEther('100'))
    expect(await token.balanceOf(account.address)).to.be.equal(parseEther('100'))
    // 9.Owner operates AA account transfer out ETH
    newOwner = createAccountOwner()
    await account.connect(accountOwner).execute(newOwner.address, ONE_ETH, '0x', { gasLimit: 10000000 })
    expect(await ethers.provider.getBalance(newOwner.address)).to.be.equal(parseEther('1').toString())

    // 10.Owner operates AA account transfer out USDT
    const transToken0 = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('10')).then(tx => tx.data!)
    await account.connect(accountOwner).execute(token.address, 0, transToken0)
    console.log(await token.balanceOf(await operator.getAddress()))
    expect(await token.balanceOf(account.address)).to.equal(parseEther('90'))

    // 11.owner operate account operator
    await account.connect(accountOwner).changeOperator(operator.getAddress())
    expect(await operator.getAddress()).to.be.equal(await account.getOperator())

    // 12.Operator operates AA account transfer out ETH
    await account.connect(operator).execute(newOwner.address, ONE_ETH, '0x', { gasLimit: 10000000 })

    // 13.Operator operates AA account transfer out USDT
    const transToken = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('10')).then(tx => tx.data!)
    await account.connect(accountOwner).execute(token.address, 0, transToken)
    console.log(await token.balanceOf(await operator.getAddress()))
    expect(await token.balanceOf(account.address)).to.equal(parseEther('80'))

    // 14.Reset the key of the owner and modify the new owner
    await account.connect(accountOwner).resetOwner(newOwner.address, { gasLimit: 10000000 })

    // 15.new Owner operates AA account transfer out ETH
    await account.connect(newOwner).execute(newOwner.address, ONE_ETH, '0x', { gasLimit: 10000000 })

    // 16.new Owner operates AA account transfer out USDT
    const transToken2 = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('20')).then(tx => tx.data!)
    await account.connect(newOwner).execute(token.address, 0, transToken2)
    expect(await token.balanceOf(account.address)).to.be.equals(parseEther('60'))

    // 17.New owner modification operator
    await account.connect(newOwner).changeOperator(newOperator.getAddress())

    // 18.new operator operates AA account transfer out ETH
    newOwner2 = createAccountOwner()
    await account.connect(newOperator).execute(newOwner2.address, ONE_ETH, '0x', { gasLimit: 10000000 })

    // 19.new operator operates AA account transfer out USDT
    const transToken3 = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('20')).then(tx => tx.data!)
    await account.connect(newOperator).execute(token.address, 0, transToken3)
    expect(await token.balanceOf(account.address)).to.be.equals(parseEther('40'))

    // 20.New owner modifying guardians, threshold values, and number of delay blocks
    await guardian.connect(newOwner).setConfig(account.address, { guardians: accounts.slice(1, 4), approveThreshold: 50, delay: DefaultDelayBlock })

    // 21.Guardian 1 authorizes the owner 2 address as the new owner of the AA account
    await guardian.connect(g1).approve(account.address, newOwner2.address)
    await expect(guardian.connect(g3).resetAccountOwner(account.address, { gasLimit: 10000000 })).to.be.revertedWith('the threshold value has not been reached')
    await guardian.connect(g2).approve(account.address, newOwner2.address)
    console.log('approve block', await ethers.provider.getBlockNumber())
    await expect(guardian.connect(g3).resetAccountOwner(account.address, { gasLimit: 10000000 })).to.be.revertedWith('the delay reset time has not yet reached')
    const currentBlock = await ethers.provider.getBlockNumber()
    for (let i = currentBlock + 1; i < currentBlock + 100; i++) {
      await ethers.provider.send('evm_mine', [])
    }
    console.log('reset block', await ethers.provider.getBlockNumber())
    await guardian.connect(g3).resetAccountOwner(account.address, { gasLimit: 10000000 })
    expect(await account.owner()).to.equal(newOwner2.address)

    // 22.Owner2 operates AA account transfer out ETH
    console.log('balance', await ethers.provider.getBalance(account.address))
    await account.connect(newOwner2).execute(newOwner2.address, ONE_ETH, '0x', { gasLimit: 10000000 })
    console.log('balance', await ethers.provider.getBalance(account.address))

    // 23.Owner2 operates AA account transfer out USDT
    const transToken4 = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('15')).then(tx => tx.data!)
    const transToken5 = await token.populateTransaction.transfer(await operator.getAddress(), parseEther('15')).then(tx => tx.data!)
    await account.connect(newOwner2).executeBatch([token.address, token.address], [transToken4, transToken5])
    expect(await token.balanceOf(account.address)).to.be.equals(parseEther('10'))

    // 24.Owner2 modification operator
    await account.connect(newOwner2).changeOperator(newOperator2.getAddress(), { gasLimit: 10000000 })
  })
})
