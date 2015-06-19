var fs = require('fs')
process.on('message', function(message) {
  if(message == 'shutdown') {
    fs.writeFileSync('tmp', 'shutdown')
    process.send('offline')
  }
})
process.send('online')
