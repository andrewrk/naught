var fs = require('fs')
  , mkdirp = require('mkdirp')
  , path = require('path')
  , spawn = require('child_process').spawn
  , net = require('net')
  , assert = require('assert')
  , async = require('async')
  , jsonSocket = require('./json_socket')
  , createLog = require('./log').create

  , argv = process.argv.slice(2)
  , workerCount = parseInt(argv.shift(), 10)
  , socketPath = argv.shift()
  , logNaughtPath = argv.shift()
  , logStderrPath = argv.shift()
  , logStdoutPath = argv.shift()
  , maxLogSize = parseInt(argv.shift(), 10)
  , script = argv.shift()
  , nodeArgsStr = argv.shift()

  , logs = null
  , socket = null
  , master = null
  , server = null

  , own = {}.hasOwnProperty;

createLogsAndIpcServer(function(err) {
  assert.ifError(err);
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

function createLogs(cb){
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
    ", new_booting: " + counts.new_booting +
    ", new_online: " + counts.new_online;
}

function onMessage(message){
  if (logs.naught) {
    var str = message.event + ".";
    if (message.count) str += " " + workerCountsFromMsg(message.count);
    logs.naught.write(str + "\n");
  }
  if (socket) jsonSocket.send(socket, message);
}

function createLogsAndIpcServer(cb) {
  async.parallel([
    createLogs, function(cb){
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
    server.listen(socketPath, function(){
      process.send('IpcListening');
      cb();
    });
  });
}
function spawnMaster(){
  var nodeArgs = splitCmdLine(nodeArgsStr);
  console.error("node_args", nodeArgs);
  var stdoutBehavior = logs.stdout ? 'pipe' : 'ignore';
  var stderrBehavior = logs.stderr ? 'pipe' : 'ignore';
  console.log("stdout beh", stdoutBehavior);
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
        new_booting: 0,
        new_online: 0
      }
    });
    server.close();
  });
}
function splitCmdLine(str){
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
