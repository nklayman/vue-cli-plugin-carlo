const webpack = require('webpack')
const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')
const fs = require('fs-extra')
const Config = require('webpack-chain')
const { getExternals, chainWebpack } = require('./lib/webpackConfig')
const {
  log,
  info,
  logWithSpinner,
  stopSpinner
} = require('@vue/cli-shared-utils')
const formatStats = require('@vue/cli-service/lib/commands/build/formatStats')

module.exports = (api, options) => {
  // If plugin options are provided in vue.config.js, those will be used. Otherwise it is empty object
  const pluginOptions =
    options.pluginOptions && options.pluginOptions.carlo
      ? options.pluginOptions.carlo
      : {}
  // If option is not set in pluginOptions, default is used
  const usesTypescript = pluginOptions.disableMainProcessTypescript
    ? false
    : api.hasPlugin('typescript')
  const mainProcessFile =
    pluginOptions.mainProcessFile ||
    (usesTypescript ? 'src/carlo_main.ts' : 'src/carlo_main.js')
  const outputDir = pluginOptions.outputDir || 'dist_carlo'
  const mainProcessChain =
    pluginOptions.chainWebpackMainProcess || (config => config)

  api.chainWebpack(async config => {
    chainWebpack(api, pluginOptions, config)
  })

  api.registerCommand(
    'carlo:build',
    {
      description: 'bundle Carlo app with pkg',
      usage: 'vue-cli-service carlo:build [pkg options]',
      details:
        `All pkg command line options are supported.\n` +
        `See https://www.npmjs.com/package/pkg for cli options\n` +
        `See https://github.com/nklayman/vue-cli-plugin-carlo for more details about this plugin.`
    },
    async (args, rawArgs) => {
      const { exec: pkg } = require('pkg')
      const bundleOutputDir = path.join(outputDir, '/bundled')

      // Prevent custom args from interfering with electron-builder
      const removeArg = (arg, count = 1) => {
        const index = rawArgs.indexOf(arg)
        if (index !== -1) rawArgs.splice(index, count)
      }
      removeArg('--mode', 2)
      removeArg('--dashboard')
      removeArg('--legacy')
      // Arguments to be passed to renderer build
      const vueArgs = {
        _: [],
        // For the cli-ui webpack dashboard
        dashboard: args.dashboard,
        // Make sure files are outputted to proper directory
        dest: bundleOutputDir,
        // Enable modern mode unless --legacy is passed
        modern: !args.legacy
      }
      // With @vue/cli-service v3.4.1+, we can bypass legacy build
      process.env.VUE_CLI_MODERN_BUILD = !args.legacy
      // If the legacy builded is skipped the output dir won't be cleaned
      await fs.removeSync(bundleOutputDir)
      await fs.ensureDirSync(bundleOutputDir)
      // Mock data from legacy build
      const pages = options.pages || { index: '' }
      Object.keys(pages).forEach(page => {
        if (pages[page].filename) {
          // If page is configured as an object, use the filename (without .html)
          page = pages[page].filename.replace(/\.html$/, '')
        }
        fs.writeFileSync(
          path.join(bundleOutputDir, `legacy-assets-${page}.html.json`),
          '[]'
        )
      })

      info('Bundling render process:')
      // Build the render process with the custom args
      await api.service.run('build', vueArgs)
      // Copy package.json to output dir
      await fs.copySync(
        api.resolve('./package.json'),
        `${outputDir}/bundled/package.json`
      )
      const bundle = bundleMain({
        mode: 'build',
        api,
        args,
        pluginOptions,
        outputDir,
        mainProcessFile,
        mainProcessChain,
        usesTypescript
      })
      logWithSpinner('Bundling main process...')
      bundle.run(async (err, stats) => {
        stopSpinner(false)
        if (err) {
          throw err
        }
        if (stats.hasErrors()) {
          // eslint-disable-next-line prefer-promise-reject-errors
          throw new Error(`Build failed with errors.`)
        }
        const targetDirShort = path.relative(
          api.service.context,
          `${outputDir}/bundled`
        )
        log(formatStats(stats, targetDirShort, api))

        await buildApp()
      })

      async function buildApp () {
        await fs.copy(
          api.resolve('./package.json'),
          api.resolve(`${outputDir}/bundled/package.json`)
        )
        info('Building app as an executable with pkg')
        pkg([
          `${outputDir}/bundled/package.json`,
          '--out-path',
          outputDir,
          ...rawArgs
        ])
      }
    }
  )

  api.registerCommand(
    'carlo:serve',
    {
      description: 'serve Carlo app',
      usage: 'vue-cli-service carlo:serve',
      details: `See https://github.com/nklayman/vue-cli-plugin-carlo for more details about this plugin.`
    },
    async args => {
      const execa = require('execa')

      const { url } = await api.service.run('serve', {
        https: true
      })
      const bundle = bundleMain({
        mode: 'serve',
        api,
        args,
        pluginOptions,
        outputDir,
        mainProcessFile,
        mainProcessChain,
        usesTypescript,
        url
      })
      logWithSpinner('Bundling main process...')
      bundle.run((err, stats) => {
        stopSpinner(false)
        if (err) {
          throw err
        }
        if (stats.hasErrors()) {
          throw new Error(`Build failed with errors.`)
        }
        const targetDirShort = path.relative(api.service.context, outputDir)
        log(formatStats(stats, targetDirShort, api))

        info('Launching Carlo...')
        const child = execa('node', [`${outputDir}/index.js`], {
          stdio: 'inherit'
        })
        child.on('exit', () => {
          process.exit(0)
        })
      })
    }
  )
}

function bundleMain ({
  mode,
  api,
  args,
  pluginOptions,
  outputDir,
  mainProcessFile,
  mainProcessChain,
  usesTypescript,
  url
}) {
  const mainProcessTypeChecking = pluginOptions.mainProcessTypeChecking || false
  const isBuild = mode === 'build'
  const NODE_ENV = process.env.NODE_ENV
  const config = new Config()
  config
    .mode(NODE_ENV)
    .target('electron-main')
    .node.set('__dirname', false)
    .set('__filename', false)
  // Set externals
  config.externals(getExternals(api, pluginOptions))

  config.output
    .path(api.resolve(outputDir + (isBuild ? '/bundled' : '')))
    .filename('[name].js')
  if (isBuild) {
    //   Set __static to __dirname (files in public get copied here)
    config
      .plugin('define')
      .use(webpack.DefinePlugin, [{ __static: '__dirname' }])
  } else {
    // Set __static to public folder
    config.plugin('define').use(webpack.DefinePlugin, [
      {
        __static: JSON.stringify(api.resolve('./public'))
      }
    ])
    if (/\/$/.test(url)) {
      // Remove trailing '/'
      url = url.substring(0, url.length - 1)
    }
    const envVars = {
      // Dev server url
      WEBPACK_DEV_SERVER_URL: url,
      // Path to node_modules (for externals in development)
      NODE_MODULES_PATH: api.resolve('./node_modules')
    }
    // Add all env vars prefixed with VUE_APP_
    Object.keys(process.env).forEach(k => {
      if (/^VUE_APP_/.test(k)) {
        envVars[k] = process.env[k]
      }
    })
    config.plugin('env').use(webpack.EnvironmentPlugin, [envVars])
  }
  if (args.debug) {
    // Enable source maps for debugging
    config.devtool('source-map')
  } else if (NODE_ENV === 'production') {
    // Minify for better performance
    config.plugin('uglify').use(TerserPlugin, [
      {
        parallel: true
      }
    ])
  }
  config.entry('index').add(api.resolve(mainProcessFile))
  const {
    transformer,
    formatter
  } = require('@vue/cli-service/lib/util/resolveLoaderError')
  config
    .plugin('friendly-errors')
    .use(require('friendly-errors-webpack-plugin'), [
      {
        additionalTransformers: [transformer],
        additionalFormatters: [formatter]
      }
    ])
  if (usesTypescript) {
    config.resolve.extensions.merge(['.js', '.ts'])
    config.module
      .rule('ts')
      .test(/\.ts$/)
      .use('ts-loader')
      .loader('ts-loader')
      .options({ transpileOnly: !mainProcessTypeChecking })
  }
  mainProcessChain(config)
  return webpack(config.toConfig())
}

module.exports.defaultModes = {
  'carlo:build': 'production',
  'carlo:serve': 'development'
}
