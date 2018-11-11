module.exports = api => {
  api.render('./template')

  api.extendPackage({
    scripts: {
      'carlo:serve': 'vue-cli-service carlo:serve',
      'carlo:build': 'vue-cli-service carlo:build'
    },
    dependencies: {
      carlo: '^0.9.20'
    }
  })
}
