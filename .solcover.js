module.exports = {
  skipFiles: [
    "test",
    "samples/bls/lib",
    //solc-coverage fails to compile our Manager module.
    "sammples/gnosis",
    "utils/Exec.sol"
  ],
};
