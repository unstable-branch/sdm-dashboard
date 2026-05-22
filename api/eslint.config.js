export default [
  {
    ignores: ["dist/", "node_modules/"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "error",
      "eqeqeq": "warn",
    },
  },
];
