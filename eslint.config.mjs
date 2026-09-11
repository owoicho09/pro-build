import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "src/db/migrations/**"],
  },
];

export default eslintConfig;
