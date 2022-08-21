import { aggregate, BlsSignerFactory, BlsVerifier } from '@thehubbleproject/bls/dist/signer'
import { arrayify, defaultAbiCoder, hexConcat } from 'ethers/lib/utils'
import {
  BLSOpen__factory,
  BLSSignatureAggregator,
  BLSSignatureAggregator__factory,
  BLSWallet,
  BLSWallet__factory,
  EntryPoint
} from '../typechain'
import { ethers } from 'hardhat'
import { AddressZero, deployEntryPoint, fund } from './testutils'
import { fillUserOp } from './UserOp'
import { expect } from 'chai'
import { keccak256 } from 'ethereumjs-util'
import { hashToPoint } from '@thehubbleproject/bls/dist/mcl'
import { BigNumber } from 'ethers'
import { BytesLike } from '@ethersproject/bytes'
import { BLSWalletDeployer } from '../typechain/contracts/bls/BLSWallet.sol'
import { BLSWalletDeployer__factory } from '../typechain/factories/contracts/bls/BLSWallet.sol'

describe('bls wallet', function () {
  this.timeout(20000)
  const BLS_DOMAIN = arrayify(keccak256(Buffer.from('eip4337.bls.domain')))
  const etherSigner = ethers.provider.getSigner()
  let fact: BlsSignerFactory
  let signer1: any
  let signer2: any
  let blsAgg: BLSSignatureAggregator
  let entrypoint: EntryPoint
  let wallet1: BLSWallet
  let wallet2: BLSWallet
  let walletDeployer: BLSWalletDeployer
  before(async () => {
    entrypoint = await deployEntryPoint(1, 1)
    const BLSOpenLib = await new BLSOpen__factory(ethers.provider.getSigner()).deploy()
    blsAgg = await new BLSSignatureAggregator__factory({
      'contracts/bls/lib/BLSOpen.sol:BLSOpen': BLSOpenLib.address
    }, ethers.provider.getSigner()).deploy()

    fact = await BlsSignerFactory.new()
    signer1 = fact.getSigner(arrayify(BLS_DOMAIN), '0x01')
    signer2 = fact.getSigner(arrayify(BLS_DOMAIN), '0x02')

    walletDeployer = await new BLSWalletDeployer__factory(etherSigner).deploy()

    wallet1 = await new BLSWallet__factory(etherSigner).deploy(entrypoint.address, blsAgg.address, signer1.pubkey)
    wallet2 = await new BLSWallet__factory(etherSigner).deploy(entrypoint.address, blsAgg.address, signer2.pubkey)
  })

  it('#aggregateSignatures', async () => {
    const sig1 = signer1.sign('0x1234')
    const sig2 = signer2.sign('0x5678')
    const offChainSigResult = hexConcat(aggregate([sig1, sig2]))
    const sigs = [sig1, sig2].map(h => hexConcat(h))
    const solidityAggResult = await blsAgg.aggregateSignatures(sigs)
    expect(solidityAggResult).to.equal(offChainSigResult)
  })

  it('#userOpToMessage', async () => {
    const userOp1 = await fillUserOp({
      sender: wallet1.address
    }, entrypoint)
    const requestHash = await blsAgg.getRequestId(userOp1)
    const solPoint: BigNumber[] = await blsAgg.userOpToMessage(userOp1)
    const messagePoint = hashToPoint(requestHash, BLS_DOMAIN)
    expect(`1 ${solPoint[0].toString()} ${solPoint[1].toString()}`).to.equal(messagePoint.getStr())
  })

  it('#validateUserOpSignature', async () => {
    const userOp1 = await fillUserOp({
      sender: wallet1.address
    }, entrypoint)
    const requestHash = await blsAgg.getRequestId(userOp1)

    const sigParts = signer1.sign(requestHash)
    userOp1.signature = hexConcat(sigParts)
    expect(userOp1.signature.length).to.equal(130) // 64-byte hex value

    const verifier = new BlsVerifier(BLS_DOMAIN)
    expect(verifier.verify(sigParts, signer1.pubkey, requestHash)).to.equal(true)

    const ret = await blsAgg.validateUserOpSignature(userOp1, false)
    expect(ret.sigForAggregation).to.equal(userOp1.signature)
    expect(ret.sigForUserOp).to.equal('0x')
  })

  it('validateSignatures', async function () {
    // yes, it does take long on hardhat, but quick on geth.
    this.timeout(30000)
    const userOp1 = await fillUserOp({
      sender: wallet1.address
    }, entrypoint)
    const requestHash = await blsAgg.getRequestId(userOp1)
    const sig1 = signer1.sign(requestHash)
    userOp1.signature = hexConcat(sig1)

    const userOp2 = await fillUserOp({
      sender: wallet2.address
    }, entrypoint)
    const requestHash2 = await blsAgg.getRequestId(userOp2)
    const sig2 = signer2.sign(requestHash2)
    userOp2.signature = hexConcat(sig2)

    const aggSig = aggregate([sig1, sig2])
    const aggregatedSig = await blsAgg.aggregateSignatures([hexConcat(sig1), hexConcat(sig2)])
    expect(hexConcat(aggSig)).to.equal(aggregatedSig)

    const pubkeys = [
      signer1.pubkey,
      signer2.pubkey
    ]
    const v = new BlsVerifier(BLS_DOMAIN)
    // off-chain check
    const now = Date.now()
    expect(v.verifyMultiple(aggSig, pubkeys, [requestHash, requestHash2])).to.equal(true)
    console.log('verifyMultiple (mcl code)', Date.now() - now, 'ms')
    const now2 = Date.now()
    console.log('validateSignatures gas= ', await blsAgg.estimateGas.validateSignatures([userOp1, userOp2], aggregatedSig))
    console.log('validateSignatures (on-chain)', Date.now() - now2, 'ms')
  })

  describe('#EntryPoint.simulateValidation with aggregator', () => {
    let initCode: BytesLike
    let entryPointStatic: EntryPoint
    let signer3: any
    before(async () => {
      signer3 = fact.getSigner(arrayify(BLS_DOMAIN), '0x03')
      initCode = hexConcat([
        walletDeployer.address,
        walletDeployer.interface.encodeFunctionData('deployWallet', [entrypoint.address, blsAgg.address, 0, signer3.pubkey])
      ])
      entryPointStatic = entrypoint.connect(AddressZero)
    })
    it('with on-chain sig validation', async () => {
      const senderAddress = await entrypoint.connect(AddressZero).callStatic.getSenderAddress(initCode)
      await fund(senderAddress, '0.01')
      const userOp = await fillUserOp({
        sender: senderAddress,
        initCode,
        nonce: 1
      }, entrypoint)
      const requestHash = await blsAgg.getRequestId(userOp)
      const sigParts = signer3.sign(requestHash)
      userOp.signature = hexConcat(sigParts)
      const {
        actualAggregator,
        sigForUserOp,
        sigForAggregation,
        offChainSigInfo
      } = await entryPointStatic.callStatic.simulateValidation(userOp, false)
      expect(offChainSigInfo).to.eq('0x')
      expect(actualAggregator).to.eq(blsAgg.address)

      expect(sigForUserOp).to.eq('0x')
      expect(sigForAggregation).to.eq(userOp.signature)
    })

    it('with off-chain sig check', async () => {
      const verifier = new BlsVerifier(BLS_DOMAIN)
      const senderAddress = await entrypoint.connect(AddressZero).callStatic.getSenderAddress(initCode)
      await fund(senderAddress, '0.01')
      const userOp = await fillUserOp({
        sender: senderAddress,
        initCode,
        nonce: 2
      }, entrypoint)
      const requestHash = await blsAgg.getRequestId(userOp)
      const sigParts = signer3.sign(requestHash)
      userOp.signature = hexConcat(sigParts)

      const {
        actualAggregator,
        sigForUserOp,
        sigForAggregation,
        offChainSigInfo
      } = await entryPointStatic.callStatic.simulateValidation(userOp, true)
      expect(actualAggregator).to.eq(blsAgg.address)

      const [signature, pubkey, requestHash1] = defaultAbiCoder.decode(['bytes32[2]', 'bytes32[4]', 'bytes32'], offChainSigInfo)
      expect(verifier.verify(signature, pubkey, requestHash1)).to.equal(true)

      expect(sigForUserOp).to.eq('0x')
      expect(sigForAggregation).to.eq(userOp.signature)
    })
  })
})
