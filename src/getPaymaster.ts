import { UserOperationStruct } from "@account-abstraction/contracts";
import { calcPreVerificationGas, PaymasterAPI } from "@account-abstraction/sdk";
import axios from "axios";
import { BytesLike, ethers } from "ethers";

import { toJSON } from "./opUtils";

const SIG_SIZE = 65;
const DUMMY_PAYMASTER_AND_DATA =
  "0x0101010101010101010101010101010101010101000000000000000000000000000000000000000000000000000001010101010100000000000000000000000000000000000000000000000000000000000000000101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101";

interface paymasterResponse {
  jsonrpc: string;
  id: number;
  result: BytesLike;
}

class VerifyingPaymasterAPI extends PaymasterAPI {
  private paymasterUrl: string;
  private entryPoint: string;
  constructor(paymasterUrl: string, entryPoint: string) {
    super();
    this.paymasterUrl = paymasterUrl;
    this.entryPoint = entryPoint;
  }

  async getPaymasterAndData(
    userOp: Partial<UserOperationStruct>,
  ): Promise<string> {
    // Hack: userOp includes empty paymasterAndData which calcPreVerificationGas requires.
    try {
      // userOp.preVerificationGas contains a promise that will resolve to an error.
      await ethers.utils.resolveProperties(userOp);
      // eslint-disable-next-line no-empty
    } catch (_) {}
    const pmOp: Partial<UserOperationStruct> = {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit,
      verificationGasLimit: userOp.verificationGasLimit,
      maxFeePerGas: userOp.maxFeePerGas,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      // A dummy value here is required in order to calculate a correct preVerificationGas value.
      paymasterAndData: DUMMY_PAYMASTER_AND_DATA,
      signature: ethers.utils.hexlify(Buffer.alloc(SIG_SIZE, 1)),
    };
    const op = await ethers.utils.resolveProperties(pmOp);
    op.preVerificationGas = calcPreVerificationGas(op);

    // Ask the paymaster to sign the transaction and return a valid paymasterAndData value.
    return axios
      .post<paymasterResponse>(this.paymasterUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "pm_sponsorUserOperation",
        params: [await toJSON(op), this.entryPoint],
      })
      .then((res) => res.data.result.toString());
  }
}

export const getVerifyingPaymaster = (
  paymasterUrl: string,
  entryPoint: string,
) => new VerifyingPaymasterAPI(paymasterUrl, entryPoint);
