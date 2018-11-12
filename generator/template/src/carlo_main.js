const carlo = require('carlo')
const isDevelopment = process.env.NODE_ENV !== 'production'
;(async () => {
  // Launch the browser.
  const app = await carlo.launch({
    width: 800,
    height: 600,
    args: isDevelopment ? ['--auto-open-devtools-for-tabs'] : []
  })

  // Terminate Node.js process on app window closing.
  app.on('exit', () => process.exit())

  // Tell carlo where your web files are located.
  if (isDevelopment) {
    app.serveOrigin(process.env.WEBPACK_DEV_SERVER_URL)
  } else {
    app.serveFolder(__dirname)
  }

  await app.exposeFunction('env', () => process.env)

  // Navigate to the main page of your app.
  await app.load('index.html')
})()
