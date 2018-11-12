const fs = require('fs')

module.exports = api => {
  api.render('./template')

  api.onCreateComplete(() => {
    // Update .gitignore if it exists
    if (fs.existsSync(api.resolve('./.gitignore'))) {
      let gitignore = fs.readFileSync(api.resolve('./.gitignore'), 'utf8')
      if (!/(#Carlo build output|\/dist_carlo|\/\.profile)/.test(gitignore)) {
        // Add /dist_carlo and /.profile to gitignore if it doesn't exist already
        gitignore += '\n#Carlo build output\n/dist_carlo\n/.profile'
        fs.writeFileSync(api.resolve('./.gitignore'), gitignore)
      }
    }
  })

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
