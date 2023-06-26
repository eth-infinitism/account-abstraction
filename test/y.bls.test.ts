import { aggregate, BlsSignerFactory, BlsVerifier } from '@thehubbleproject/bls/dist/signer'
import { getBytes, concat, Signer, resolveAddress, AddressLike, BigNumberish } from 'ethers'
import {
  BLSOpen__factory,
  BLSSignatureAggregator,
  BLSSignatureAggregator__factory,
  BLSAccount,
  BLSAccount__factory,
  BLSAccountFactory,
  BLSAccountFactory__factory,
  BrokenBLSAccountFactory__factory,
  EntryPoint
} from '../src/types'
import { ethers } from 'hardhat'
import {
  createAddress,
  defaultAbiCoder,
  deployEntryPoint,
  fund,
  ONE_ETH,
  simulationResultWithAggregationCatch
} from './testutils'
import { DefaultsForUserOp, fillUserOp } from './UserOp'
import { expect } from 'chai'
import { keccak256 } from 'ethereumjs-util'
import { hashToPoint } from '@thehubbleproject/bls/dist/mcl'
import { hexValue } from '@ethersproject/bytes'

async function deployBlsAccount (ethersSigner: Signer, factoryAddr: AddressLike, blsSigner: any): Promise<BLSAccount> {
  const factory = BLSAccountFactory__factory.connect(await resolveAddress(factoryAddr), ethersSigner)
  const addr = await factory.createAccount.staticCall(0, blsSigner.pubkey)
  await factory.createAccount(0, blsSigner.pubkey)
  return BLSAccount__factory.connect(addr, ethersSigner)
}

describe('bls account', function () {
  this.timeout(20000)
  const BLS_DOMAIN = getBytes(keccak256(Buffer.from('eip4337.bls.domain')))
  let etherSigner: Signer
  let fact: BlsSignerFactory
  let signer1: any
  let signer2: any
  let blsAgg: BLSSignatureAggregator
  let entrypoint: EntryPoint
  let account1: BLSAccount
  let account2: BLSAccount
  let accountDeployer: BLSAccountFactory
  before(async () => {
    etherSigner = await ethers.provider.getSigner()
    entrypoint = await deployEntryPoint()
    const BLSOpenLib = await new BLSOpen__factory(await ethers.provider.getSigner()).deploy()
    blsAgg = await new BLSSignatureAggregator__factory({
      'contracts/samples/bls/lib/BLSOpen.sol:BLSOpen': await resolveAddress(BLSOpenLib.target)
    }, await ethers.provider.getSigner()).deploy()

    await blsAgg.addStake(entrypoint.target, 2, { value: ONE_ETH })
    fact = await BlsSignerFactory.new()
    signer1 = fact.getSigner(getBytes(BLS_DOMAIN), '0x01')
    signer2 = fact.getSigner(getBytes(BLS_DOMAIN), '0x02')

    accountDeployer = await new BLSAccountFactory__factory(etherSigner).deploy(entrypoint.target, blsAgg.target)

    account1 = await deployBlsAccount(etherSigner, accountDeployer.target, signer1)
    account2 = await deployBlsAccount(etherSigner, accountDeployer.target, signer2)
  })

  it('#getTrailingPublicKey', async () => {
    const data = defaultAbiCoder.encode(['uint[6]'], [[1, 2, 3, 4, 5, 6]])
    const last4 = await blsAgg.getTrailingPublicKey(data)
    expect(last4).to.eql([3n, 4n, 5n, 6n])
  })
  it('#aggregateSignatures', async () => {
    const sig1 = signer1.sign('0x1234')
    const sig2 = signer2.sign('0x5678')
    const offChainSigResult = concat(aggregate([sig1, sig2]))
    const userOp1 = { ...DefaultsForUserOp, signature: concat(sig1) }
    const userOp2 = { ...DefaultsForUserOp, signature: concat(sig2) }
    const solidityAggResult = await blsAgg.aggregateSignatures([userOp1, userOp2])
    expect(solidityAggResult).to.equal(offChainSigResult)
  })

  it('#userOpToMessage', async () => {
    const userOp1 = await fillUserOp({
      sender: account1.target
    }, entrypoint)
    const requestHash = await blsAgg.getUserOpHash(userOp1)
    const solPoint: BigNumberish[] = await blsAgg.userOpToMessage(userOp1)
    const messagePoint = hashToPoint(requestHash, BLS_DOMAIN)
    expect(`1 ${solPoint[0].toString()} ${solPoint[1].toString()}`).to.equal(messagePoint.getStr())
  })

  it('#validateUserOpSignature', async () => {
    const userOp1 = await fillUserOp({
      sender: account1.target
    }, entrypoint)
    const requestHash = await blsAgg.getUserOpHash(userOp1)

    const sigParts = signer1.sign(requestHash)
    userOp1.signature = concat(sigParts)
    expect(userOp1.signature.length).to.equal(130) // 64-byte hex value

    const verifier = new BlsVerifier(BLS_DOMAIN)
    expect(verifier.verify(sigParts, signer1.pubkey, requestHash)).to.equal(true)

    const ret = await blsAgg.validateUserOpSignature(userOp1)
    expect(ret).to.equal('0x')
  })

  it('aggregated sig validation must succeed if off-chain UserOp sig succeeds', async () => {
    // regression AA-119: prevent off-chain signature success and on-chain revert.
    // "broken account" uses different public-key during construction and runtime.
    const brokenAccountFactory = await new BrokenBLSAccountFactory__factory(etherSigner).deploy(entrypoint.target, blsAgg.target)
    // const brokenAccountFactory = await new BLSAccountFactory__factory(etherSigner).deploy(entrypoint.target, blsAgg.target)
    const deployTx = await brokenAccountFactory.createAccount.populateTransaction(0, signer1.pubkey)
    const res = await brokenAccountFactory.runner!.call!(deployTx)
    const acc = brokenAccountFactory.interface.decodeFunctionResult('createAccount', res)[0]
    await fund(acc)
    const userOp = await fillUserOp({
      sender: acc,
      initCode: concat([await resolveAddress(brokenAccountFactory.target), deployTx.data!])
    }, entrypoint)
    const requestHash = await blsAgg.getUserOpHash(userOp)
    const signature = userOp.signature = concat(signer1.sign(requestHash))

    // and sig validation should fail:
    const singleOpSigCheck = await blsAgg.validateUserOpSignature(userOp).then(() => 'ok', e => e.message) as string

    // above account should fail on-chain:
    const beneficiary = createAddress()
    const handleRet = await entrypoint.handleAggregatedOps.staticCall([
      {
        userOps: [userOp],
        aggregator: blsAgg.target,
        signature
      }
    ], beneficiary).then(() => 'ok', e => e.errorName) as string

    expect(`${singleOpSigCheck},${handleRet}`)
      .to.eq('ok,ok')
  })

  it('validateSignatures', async function () {
    // yes, it does take long on hardhat, but quick on geth.
    this.timeout(30000)
    const userOp1 = await fillUserOp({
      sender: account1.target
    }, entrypoint)
    const requestHash = await blsAgg.getUserOpHash(userOp1)
    const sig1 = signer1.sign(requestHash)
    userOp1.signature = concat(sig1)

    const userOp2 = await fillUserOp({
      sender: account2.target
    }, entrypoint)
    const requestHash2 = await blsAgg.getUserOpHash(userOp2)
    const sig2 = signer2.sign(requestHash2)
    userOp2.signature = concat(sig2)

    const aggSig = aggregate([sig1, sig2])
    const aggregatedSig = await blsAgg.aggregateSignatures([userOp1, userOp2])
    expect(concat(aggSig)).to.equal(aggregatedSig)

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
    console.log('validateSignatures gas= ', await blsAgg.validateSignatures.estimateGas([userOp1, userOp2], aggregatedSig))
    console.log('validateSignatures (on-chain)', Date.now() - now2, 'ms')
  })

  describe('#EntryPoint.simulateValidation with aggregator', () => {
    let initCode: string
    let signer3: any
    before(async () => {
      signer3 = fact.getSigner(getBytes(BLS_DOMAIN), '0x03')
      initCode = concat([
        await resolveAddress(accountDeployer.target),
        accountDeployer.interface.encodeFunctionData('createAccount', [0, signer3.pubkey])
      ])
    })

    it('validate after simulation returns ValidationResultWithAggregation', async () => {
      const verifier = new BlsVerifier(BLS_DOMAIN)
      const senderAddress = await entrypoint.getSenderAddress.staticCall(initCode).catch(e => e.errorArgs.sender)
      await fund(senderAddress, '0.01')
      const userOp = await fillUserOp({
        sender: senderAddress,
        initCode
      }, entrypoint)
      const requestHash = await blsAgg.getUserOpHash(userOp)
      const sigParts = signer3.sign(requestHash)
      userOp.signature = concat(sigParts)

      const { aggregatorInfo } = await entrypoint.simulateValidation.staticCall(userOp).catch(simulationResultWithAggregationCatch)
      expect(aggregatorInfo.aggregator).to.eq(blsAgg.target)
      expect(aggregatorInfo.stakeInfo.stake).to.eq(ONE_ETH)
      expect(aggregatorInfo.stakeInfo.unstakeDelaySec).to.eq(2)

      const [signature] = defaultAbiCoder.decode(['bytes32[2]'], userOp.signature)
      const pubkey = (await blsAgg.getUserOpPublicKey(userOp)).map(n => hexValue(n)) // TODO: returns uint256[4], verify needs bytes32[4]
      const requestHash1 = await blsAgg.getUserOpHash(userOp)

      // @ts-ignore
      expect(verifier.verify(signature, pubkey, requestHash1)).to.equal(true)
    })
  })
})
