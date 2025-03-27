import { defaultAbiCoder, hexConcat, arrayify, parseEther } from "ethers/lib/utils";
import { VerifyingPaymaster__factory, EntryPoint__factory, SimpleAccount__factory } from "../typechain";
import { getProvider, getUserWallet, getWallet } from "./env";
import { fillAndSign, fillSignAndPack, packUserOp, simulateValidation } from "../test/UserOp";
import { AddressZero, parseValidationData } from "../test/testutils";
import {utils} from "ethers"

const MOCK_VALID_UNTIL = '0x00000000deadbeef';
const MOCK_VALID_AFTER = '0x0000000000001234';

async function main() {
  // Replace these with your deployed contract addresses
  const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
  const PAYMASTER_ADDRESS = "0xf39542544106e5f53b2144d7AdFcDd32A1dA0290";

  const ACCOUNT_ADDRESS = "0xcfa6bd00025132AD5865e39e48f1d255B6E4c196";

  const signer = await getWallet();
  const userWallet = await getUserWallet();
  const provider = await getProvider();

  console.log("Testing with signer:", signer.address);

  // Connect to deployed contracts
  const entryPoint = EntryPoint__factory.connect(ENTRY_POINT_ADDRESS, signer);
  const paymaster = VerifyingPaymaster__factory.connect(PAYMASTER_ADDRESS, signer);
  const account = SimpleAccount__factory.connect(ACCOUNT_ADDRESS, signer);

  // Create account here 

  // Create a wallet for offchain signing
  const offchainSigner = signer;
  console.log("Offchain signer address:", offchainSigner.address);

  // Fund the paymaster
  const stakeTx = await paymaster.addStake(1, { value: parseEther('2') });
  await stakeTx.wait();
  console.log("Added stake to paymaster");

  const depositTx = await entryPoint.depositTo(paymaster.address, { value: parseEther('1') });
  await depositTx.wait();
  console.log("Deposited to entry point for paymaster");

  // Create and sign the UserOperation
  console.log("account address", account.address);
  console.log("paymaster address", paymaster.address);
  const userOp1 = await fillAndSign({
    sender: account.address,
    paymaster: paymaster.address,
    paymasterData: hexConcat(
      [defaultAbiCoder.encode(['uint48', 'uint48'], [MOCK_VALID_UNTIL, MOCK_VALID_AFTER]), '0x' + '00'.repeat(65)])
  }, userWallet, entryPoint);

  // Get the hash that needs to be signed
  const hash = await paymaster.getHash(packUserOp(userOp1), MOCK_VALID_UNTIL, MOCK_VALID_AFTER);
  console.log("hash", hash);

  // Sign the hash with offchain signer
  const sig = await offchainSigner.signMessage(arrayify(hash));
  console.log("Generated signature:", sig);

  // Pack the UserOperation with the signature
  const userOp = await fillSignAndPack({
    ...userOp1,
    paymaster: paymaster.address,
    paymasterData: hexConcat([defaultAbiCoder.encode(['uint48', 'uint48'], [MOCK_VALID_UNTIL, MOCK_VALID_AFTER]), sig])
  }, signer, entryPoint);

  console.log("userOp", userOp);

  // Simulate validation
  const res = await simulateValidation(userOp, entryPoint.address);
  const validationData = parseValidationData(res.returnInfo.paymasterValidationData);
  console.log("Validation data:", validationData);

  if (validationData.aggregator === AddressZero && 
      validationData.validAfter === parseInt(MOCK_VALID_AFTER) && 
      validationData.validUntil === parseInt(MOCK_VALID_UNTIL)) {
    console.log("UserOperation is valid with the provided signature.");
  } else {
    console.error("UserOperation validation failed.");
  }

  // entry point 
  // call hnadle ops entrypoint 
  const gasLimit = utils.hexlify(1000000); // Example gas limit, adjust as needed


  const tx = await entryPoint.handleOps([userOp], account.address, { gasLimit });
  console.log("tx", tx);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });