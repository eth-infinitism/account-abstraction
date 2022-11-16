module.exports = {
  skipFiles: [
    "test",
    "bls/lib",
    //solc-coverage fails to compile our Manager module.
    "gnosis",
    "samples/SimpleWalletForTokens.sol"
  ],
};
