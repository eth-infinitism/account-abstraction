module.exports = {
  trailingComma: 'all',
  tabWidth: 2,
  singleQuote: true,
  semi: true,
  importOrder: ['^[./]', '^@/(.*)$'],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  importOrderGroupNamespaceSpecifiers: true,
  importOrderCaseInsensitive: true,
  plugins: ['@trivago/prettier-plugin-sort-imports'],
};
