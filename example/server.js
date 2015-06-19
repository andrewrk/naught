// npm install express express-domain-errors express-graceful-exit
var domain = require('domain');
var domainError = require('express-domain-errors');
var express = require('express');
var gracefulExit = require('express-graceful-exit');
var http = require('http');
var util = require('util');

var serverDomain = domain.create();
serverDomain.run(function () {
  var app, server;

  function sendOfflineMsg() {
    if (process.send) {
      process.send('offline');
    }
  }

  function doGracefulExit(err) {
    console.log('Server shutting down');
    gracefulExit.gracefulExitHandler(app, server);
  }

  process.on('message', function (message) {
    if (message === 'shutdown') {
      doGracefulExit();
    }
  });

  app = express();
  app.use(domainError(sendOfflineMsg, doGracefulExit));
  app.use(gracefulExit.middleware(app));

  app.get('/', function (req, res) {
    res.set('Content-Type', 'text/plain');
    res.send('Hello world\n');
  });
  app.get('/bad', function (req, res) {
    process.nextTick(/*process.domain.intercept*/(function () {
      nonexistentFunction();
    }));
  });

  app.use(function (req, res, next) {
    var err = new Error(util.format('The requested URL %s was not found on this server.', req.url));
    err.status = 404;
    next(err);
  });

  app.use(function (err, req, res, next) {
    var status = err.status || 500;
    var message = err.message || 'The server encountered an internal error or misconfiguration and was unable to complete your request.';
    res.set('Content-Type', 'text/plain');
    res.status(status);
    res.send(http.STATUS_CODES[status] + '\n\n' + message + '\n');
  });

  server = app.listen(process.env.LISTEN_FD ? {fd: parseInt(process.env.LISTEN_FD, 10)} : (process.env.PORT || 8000), function () {
    console.log('Server listening on port %d', server.address().port);
    if (process.send) {
      process.send('online');
    }
  });
});
