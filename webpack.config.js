const path = require("path");

const typescriptRule = {
  test: /\.ts$/,
  exclude: [/node_modules/, /\.test\.ts$/, /src\/test\//, /src\/__tests__\//],
  use: "ts-loader",
};

module.exports = [
  {
    target: "node",
    mode: "none",
    entry: "./src/extension.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "extension.js",
      libraryTarget: "commonjs2",
    },
    externals: {
      vscode: "commonjs vscode",
      "node-pty": "commonjs node-pty",
    },
    resolve: { extensions: [".ts", ".js"] },
    module: { rules: [typescriptRule] },
    devtool: "nosources-source-map",
  },
  {
    target: "web",
    mode: "none",
    entry: "./src/webview/main.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "webview.js",
    },
    resolve: { extensions: [".ts", ".js"] },
    module: {
      rules: [
        typescriptRule,
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
      ],
    },
    devtool: "nosources-source-map",
    performance: { hints: false },
  },
];
