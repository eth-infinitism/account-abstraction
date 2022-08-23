module.exports = {
  skipFiles: [
    "test",
    //solc-coverage fails to compile our Manager module.
    "gnosis",
    "samples/SimpleWalletForTokens.sol"
  ],
};
