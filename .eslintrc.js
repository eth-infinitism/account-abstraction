module.exports = {
  env: {
    browser: true,
    es6: true,
    jest: true,
    mocha: true,
    node: true,
  },
  globals: {
    artifacts: false,
    assert: false,
    contract: false,
    web3: false,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  // This is needed to add configuration to rules with type information
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json"],
  },
  ignorePatterns: [
    ".eslintrc.js",
    "**/types/truffle-contracts",
    "coverage",
    "dist/",
  ],
  rules: {
    "no-console": "off",
    "prefer-const": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/no-inferrable-types": "warn",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/return-await": "off",
    "@typescript-eslint/require-array-sort-compare": [
      "error",
      {
        ignoreStringArrays: true,
      },
    ],
  },
  overrides: [
    {
      files: "*",
      rules: {
        "@typescript-eslint/naming-convention": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
      },
    },
    {
      files: ["**/test/**/*.ts"],
      rules: {
        "no-unused-expressions": "off",
        // chai assertions trigger this rule
        "@typescript-eslint/no-unused-expressions": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
      },
    },
    {
      // otherwise it will raise an error in every JavaScript file
      files: ["*.ts"],
      rules: {
        "@typescript-eslint/prefer-ts-expect-error": "off",
        // allow using '${val}' with numbers, bool and null types
        "@typescript-eslint/restrict-template-expressions": [
          "error",
          {
            allowNumber: true,
            allowBoolean: true,
            allowNullish: true,
            allowNullable: true,
          },
        ],
      },
    },
  ],
};
