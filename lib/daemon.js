var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var spawn = require('child_process').spawn;
var net = require('net');
var assert = require('assert');
var async = require('async');
var jsonSocket = require('./json_socket');
var createLog = require('./log').create;

var own = {}.hasOwnProperty;

exports.start = startDaemon;

function startDaemon(argv) {
  var workerCount = parseInt(argv.shift(), 10);
  var socketPath = argv.shift();
  var logNaughtPath = argv.shift();
  var logStderrPath = argv.shift();
  var logStdoutPath = argv.shift();
  var maxLogSize = parseInt(argv.shift(), 10);
  var script = argv.shift();
  var nodeArgsStr = argv.shift();
  var pidFile = argv.shift();

  var naughtLog = null;
  var stderrLog = null;
  var stdoutLog = null;

  var naughtLogBehavior = null;
  var stderrBehavior = null;
  var stdoutBehavior = null;

  var socket = null;
  var master = null;
  var server = null;
  
  fs.writeFileSync(pidFile, process.pid);

  createLogsAndIpcServer(function(err) {
    if (err) {
      processSend({event: 'Error', value: err.message});
      return;
    }

    process.on('SIGHUP', function() {
      handleSocketMessage({
        action: 'NaughtDeploy',
        newWorkerCount: 0,
        environment: {},
        timeout: null,
        cwd: null,
      });
    });

    process.on('SIGTERM', function() {
      handleSocketMessage({ action: 'NaughtShutdown' });
    });

    process.on('SIGINT', function() {
      handleSocketMessage({ action: 'NaughtShutdown' });
    });

    processSend({event: 'IpcListening'});
    spawnMaster();
  });

  function maybeCreateLog(logPath, cb) {
    // special case /dev/null - disable logging altogether
    if (logPath === '/dev/null') {
      cb(null, {
        behavior: 'ignore',
        log: null,
      });
    } else if (logPath === '-') {
      cb(null, {
        behavior: 'inherit',
        log: null,
      });
    } else {
      createLog(logPath, maxLogSize, function(err, logStream) {
        if (err) return cb(err);
        cb(null, {
          behavior: 'pipe',
          log: logStream,
        });
      });
    }
  }

  function createLogs(cb) {
    async.parallel({
      naught: function(cb){
        maybeCreateLog(logNaughtPath, cb);
      },
      stderr: function(cb){
        maybeCreateLog(logStderrPath, cb);
      },
      stdout: function(cb){
        maybeCreateLog(logStdoutPath, cb);
      }
    }, function(err, results){
      if (err) return cb(err);

      naughtLog = results.naught.log;
      stderrLog = results.stderr.log;
      stdoutLog = results.stdout.log;

      stderrBehavior = results.stderr.behavior;
      stdoutBehavior = results.stdout.behavior;
      naughtLogBehavior = results.naught.behavior;
      if (naughtLogBehavior === 'inherit') {
        naughtLog = process.stderr;
      }

      if (stderrBehavior === 'pipe') {
        stderrLog.on('error', function(err) {
          log("Error writing to " + logStderrPath + ": " + err.stack + "\n");
        });
      }
      if (stdoutBehavior === 'pipe') {
        stdoutLog.on('error', function(err) {
          log("Error writing to " + logStdoutPath + ": " + err.stack + "\n");
        });
      }
      if (naughtLogBehavior === 'pipe') {
        naughtLog.on('error', function(err){
          process.stderr.write("Error writing to " + logNaughtPath + ": " + err.stack + "\n");
        });
      }
      cb();
    });
  }

  function log(str) {
    if (naughtLog) naughtLog.write(str);
  }

  function workerCountsFromMsg(counts) {
    return "booting: " + counts.booting +
      ", online: " + counts.online +
      ", dying: " + counts.dying +
      ", new_online: " + counts.new_online;
  }

  function onMessage(message) {
    if (naughtLog) {
      var str = message.event + ".";
      if (message.count) str += " " + workerCountsFromMsg(message.count);
      naughtLog.write(str + "\n");
    }
    if (socket) jsonSocket.send(socket, message);
    processSend(message);
  }

  function createLogsAndIpcServer(cb) {
    async.parallel([
      createLogs,
      function(cb){
        mkdirp(path.dirname(socketPath), cb);
      }
    ], function(err){
      if (err) return cb(err);
      server = net.createServer(function(newSocket){
        if (socket != null) {
          log("Warning: Only one connection to daemon allowed. Terminating old connection.\n");
          socket.destroy();
        }
        socket = newSocket;
        socket.on('error', function(err){
          log("Error: ipc channel socket: " + err.stack + "\n");
        });
        socket.once('end', function(){
          socket = null;
        });
        jsonSocket.listen(socket, function(msg){
          var response = handleSocketMessage(msg);
          if (response) {
            jsonSocket.send(response);
          }
        });
      });
      server.listen(socketPath, cb);
    });
  }

  function spawnMaster() {
    var nodeArgs = splitCmdLine(nodeArgsStr);
    var stdoutValue = (stdoutBehavior === 'inherit') ? process.stdout : stdoutBehavior;
    var stderrValue = (stderrBehavior === 'inherit') ? process.stderr : stderrBehavior;
    master = spawn(process.execPath, nodeArgs.concat([path.join(__dirname, "master.js"), workerCount, script]).concat(argv), {
      env: process.env,
      stdio: [process.stdin, stdoutValue, stderrValue, 'ipc'],
      cwd: process.cwd(),
    });
    master.on('message', onMessage);
    if (stdoutBehavior === 'pipe') {
      master.stdout.pipe(stdoutLog, {end: false});
    }
    if (stderrBehavior === 'pipe') {
      master.stderr.pipe(stderrLog, {end: false});
    }
    master.on('close', function(){
      onMessage({
        event: 'Shutdown',
        count: {
          booting: 0,
          online: 0,
          dying: 0,
          new_online: 0
        }
      });
      if (fs.existsSync(pidFile))
        fs.unlinkSync(pidFile);
      server.close();
    });
  }

  function handleSocketMessage(msg) {
    if (master != null) {
      if (msg.action === 'NaughtDeploy') {
        extend(process.env, msg.environment);
      }
      master.send(msg);
      return null;
    } else {
      processSend({event: 'Error', value: 'StillBooting'});
      return {
        event: 'ErrorStillBooting',
      };
    }
  }
}

function splitCmdLine(str) {
  if (str.length === 0) {
    return [];
  } else {
    return str.split(/\s+/);
  }
}

function extend(obj, src) {
  for (var key in src) {
    if (own.call(src, key)) obj[key] = src[key];
  }
  return obj;
}

function processSend(msg) {
  try {
    process.send(msg);
  } catch (err) {
    // ignore
  }
}
