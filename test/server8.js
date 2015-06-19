
process.send('online')
setTimeout(function(){
    process.send('offline')
}, 1000);

