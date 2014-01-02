var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var spawn = require('child_process').spawn;
var net = require('net');
var assert = require('assert');
var async = require('async');
var jsonSocket = require('./json_socket');
var createLog = require('./log').create;

var argv = process.argv.slice(2);
var workerCount = parseInt(argv.shift(), 10);
var socketPath = argv.shift();
var logNaughtPath = argv.shift();
var logStderrPath = argv.shift();
var logStdoutPath = argv.shift();
var maxLogSize = parseInt(argv.shift(), 10);
var script = argv.shift();
var nodeArgsStr = argv.shift();

var logs = null;
var socket = null;
var master = null;
var server = null;

var own = {}.hasOwnProperty;

createLogsAndIpcServer(function(err) {
  if (err) {
    process.send({type: 'Error', value: err.message});
    return;
  }
  process.send({type: 'IpcListening'});
  spawnMaster();
});

function maybeCreateLog(logPath, cb) {
  // special case /dev/null - disable logging altogether
  if (logPath === '/dev/null') {
    cb(null, null);
  } else {
    createLog(logPath, maxLogSize, cb);
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
    logs = results;
    if (logs.stderr) {
      logs.stderr.on('error', function(err) {
        log("Error writing to " + logStderrPath + ": " + err.stack + "\n");
      });
    }
    if (logs.stdout) {
      logs.stdout.on('error', function(err) {
        log("Error writing to " + logStdoutPath + ": " + err.stack + "\n");
      });
    }
    if (logs.naught) {
      logs.naught.on('error', function(err){
        process.stderr.write("Error writing to " + logNaughtPath + ": " + err.stack + "\n");
      });
    }
    cb();
  });
}

function log(str) {
  if (logs.naught) logs.naught.write(str);
  process.stderr.write(str);
}

function workerCountsFromMsg(counts) {
  return "booting: " + counts.booting +
    ", online: " + counts.online +
    ", dying: " + counts.dying +
    ", new_online: " + counts.new_online;
}

function onMessage(message) {
  if (logs.naught) {
    var str = message.event + ".";
    if (message.count) str += " " + workerCountsFromMsg(message.count);
    logs.naught.write(str + "\n");
  }
  if (socket) jsonSocket.send(socket, message);
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
        if (master != null) {
          if (msg.action === 'NaughtDeploy') {
            extend(process.env, msg.environment);
          }
          master.send(msg);
        } else {
          jsonSocket.send(socket, {
            event: 'ErrorStillBooting'
          });
        }
      });
    });
    server.listen(socketPath, cb);
  });
}

function spawnMaster() {
  var nodeArgs = splitCmdLine(nodeArgsStr);
  var stdoutBehavior = logs.stdout ? 'pipe' : 'ignore';
  var stderrBehavior = logs.stderr ? 'pipe' : 'ignore';
  master = spawn(process.execPath, nodeArgs.concat([path.join(__dirname, "master.js"), workerCount, script]).concat(argv), {
    env: process.env,
    stdio: [process.stdin, stdoutBehavior, stderrBehavior, 'ipc'],
    cwd: process.cwd()
  });
  master.on('message', onMessage);
  if (logs.stdout) {
    master.stdout.on('data', logs.stdout.write);
  }
  if (logs.stderr) {
    master.stderr.on('data', logs.stderr.write);
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
    server.close();
  });
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
