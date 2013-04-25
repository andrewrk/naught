var fs, mkdirp, path, spawn, net, assert, async, json_socket, createLog, argv, worker_count, socket_path, log_naught_path, log_stderr_path, log_stdout_path, max_log_size, script, node_args_str, logs, socket, master, server;
fs = require('fs');
mkdirp = require('mkdirp');
path = require('path');
spawn = require('child_process').spawn;
net = require('net');
assert = require('assert');
async = require('async');
json_socket = require('./json_socket');
createLog = require('./log').create;
argv = process.argv.slice(2);
worker_count = parseInt(argv.shift());
socket_path = argv.shift();
log_naught_path = argv.shift();
log_stderr_path = argv.shift();
log_stdout_path = argv.shift();
max_log_size = parseInt(argv.shift());
script = argv.shift();
node_args_str = argv.shift();
logs = null;
socket = null;
master = null;
server = null;
function maybeCreateLog(log_path, cb){
  if (log_path === '/dev/null') {
    cb(null, null);
  } else {
    createLog(log_path, max_log_size, cb);
  }
}
function createLogs(cb){
  async.parallel({
    naught: function(cb){
      maybeCreateLog(log_naught_path, cb);
    },
    stderr: function(cb){
      maybeCreateLog(log_stderr_path, cb);
    },
    stdout: function(cb){
      maybeCreateLog(log_stdout_path, cb);
    }
  }, function(err, results){
    var ref$;
    if (err) {
      return cb(err);
    }
    logs = results;
    if ((ref$ = logs.stderr) != null) {
      ref$.on('error', function(err){
        log("Error writing to " + log_stderr_path + ": " + err.stack + "\n");
      });
    }
    if ((ref$ = logs.stdout) != null) {
      ref$.on('error', function(err){
        log("Error writing to " + log_stdout_path + ": " + err.stack + "\n");
      });
    }
    if ((ref$ = logs.naught) != null) {
      ref$.on('error', function(err){
        process.stderr.write("Error writing to " + log_naught_path + ": " + err.stack + "\n");
      });
    }
    cb();
  });
}
function log(str){
  var ref$;
  if ((ref$ = logs.naught) != null) {
    ref$.write(str);
  }
  process.stderr.write(str);
}
function workerCountsFromMsg(msg){
  var ref$;
  return "booting: " + ((ref$ = msg.count) != null ? ref$.booting : void 8) + ", online: " + ((ref$ = msg.count) != null ? ref$.online : void 8) + ", dying: " + ((ref$ = msg.count) != null ? ref$.dying : void 8) + ", new_booting: " + ((ref$ = msg.count) != null ? ref$.new_booting : void 8) + ", new_online: " + ((ref$ = msg.count) != null ? ref$.new_online : void 8);
}
function onMessage(message){
  var ref$;
  if ((ref$ = logs.naught) != null) {
    ref$.write(message.event + ". " + workerCountsFromMsg(message) + "\n");
  }
  if (socket != null) {
    json_socket.send(socket, message);
  }
}
function createLogsAndIpcServer(cb){
  async.parallel([
    createLogs, function(cb){
      mkdirp(path.dirname(socket_path), cb);
    }
  ], function(err){
    if (err) {
      return cb(err);
    }
    server = net.createServer(function(new_socket){
      if (socket != null) {
        log("Warning: Only one connection to daemon allowed. Terminating old connection.\n");
        socket.destroy();
      }
      socket = new_socket;
      socket.on('error', function(err){
        log("Error: ipc channel socket: " + err.stack + "\n");
      });
      socket.once('end', function(){
        socket = null;
      });
      json_socket.listen(socket, function(msg){
        if (master != null) {
          if (msg.action === 'NaughtDeploy') {
            import$(process.env, msg.environment);
          }
          master.send(msg);
        } else {
          json_socket.send(socket, {
            event: 'ErrorStillBooting'
          });
        }
      });
    });
    server.listen(socket_path, function(){
      process.send('IpcListening');
      cb();
    });
  });
}
function spawnMaster(){
  var node_args, stdout_behavior, stderr_behavior;
  node_args = splitCmdLine(node_args_str);
  console.error("node_args", node_args);
  stdout_behavior = logs.stdout != null ? 'pipe' : 'ignore';
  stderr_behavior = logs.stderr != null ? 'pipe' : 'ignore';
  console.log("stdout beh", stdout_behavior);
  master = spawn(process.execPath, node_args.concat([path.join(__dirname, "master.js"), worker_count, script]).concat(argv), {
    env: process.env,
    stdio: [process.stdin, stdout_behavior, stderr_behavior, 'ipc'],
    cwd: process.cwd()
  });
  master.on('message', onMessage);
  if (logs.stdout != null) {
    master.stdout.on('data', logs.stdout.write);
  }
  if (logs.stderr != null) {
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
createLogsAndIpcServer(function(err){
  assert.ifError(err);
  spawnMaster();
});
function import$(obj, src){
  var own = {}.hasOwnProperty;
  for (var key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}