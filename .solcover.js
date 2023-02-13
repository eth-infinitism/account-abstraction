module.exports = {
  skipFiles: [
    "test",
    "samples/bls/lib",
    //solc-coverage fails to compile our Manager module.
    "samples/gnosis",
    "utils/Exec.sol"
  ],
};
