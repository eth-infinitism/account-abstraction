const path = require("path");

const buildLintCommand = (filenames) =>
  `eslint ${filenames.map((f) => path.relative(process.cwd(), f)).join(" ")}`;

const buildSolhintCommand = (filenames) =>
  `solhint --max-warnings 0 ${filenames
    .map((f) => path.relative(process.cwd(), f))
    .join(" ")} `;

const buildPrettierCommand = (filenames) =>
  `prettier --check ${filenames
    .map((f) => path.relative(process.cwd(), f))
    .join(" ")} `;

module.exports = {
  "**/*.{js,jsx,ts,tsx}": [buildLintCommand],
  "**/*.{js,jsx,ts,tsx,sol}": [buildPrettierCommand],
  "**/*.sol": [buildSolhintCommand],
};
