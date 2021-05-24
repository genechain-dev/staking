const path = require('path')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const SentryWebpackPlugin = require('@sentry/webpack-plugin')
const { BugsnagSourceMapUploaderPlugin } = require('webpack-bugsnag-plugins')

const webpack = require('webpack')

const DIST = path.resolve(__dirname, 'dist')

module.exports = {
  devtool: 'source-map',
  mode: 'development',
  entry: './src/index.js',
  output: {
    filename: './[name].[contenthash].js',
    path: DIST,
    publicPath: ''
  },
  devServer: {
    contentBase: DIST,
    port: 9011,
    writeToDisk: true
  },
  plugins: [
    new CleanWebpackPlugin({ cleanStaleWebpackAssets: false }),

    new webpack.ProvidePlugin({
      $: 'jquery',
      jQuery: 'jquery'
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: '!!raw-loader!./src/index.html',
      scriptLoading: 'blocking',
      minify: { removeComments: true, collapseWhitespace: true, removeAttributeQuotes: true }
    }),
    // for build scripts
    new CopyPlugin({
      patterns: [
        {
          from: './src/CNAME'
        }
      ]
    }),
    process.env.BUGSNAG_API_KEY
      ? new BugsnagSourceMapUploaderPlugin({
          apiKey: process.env.BUGSNAG_API_KEY,
          appVersion: process.env.npm_package_version
        })
      : false,
    process.env.SENTRY_AUTH_TOKEN
      ? new SentryWebpackPlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: 'genechain',
          project: 'staking',
          release: process.env.npm_package_version,
          // webpack specific configuration
          include: '.',
          ignore: ['node_modules', 'webpack.config.js']
        })
      : false
  ].filter(Boolean)
}
