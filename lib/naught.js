var fs = require('fs');
var os = require('os');
var net = require('net');
var assert = require('assert');
var json_socket = require('./json_socket');
var spawn = require('child_process').spawn;
var path = require('path');
var CWD = process.cwd();
var daemon = require('./daemon');

var naught={
  start:  startScript,
  stop: stopScript,
  status: displayStatus,
  deploy: deploy,
  deployAbort: deployAbort
};

function connectToDaemon(socket_path, cbs){
  var socket = net.connect(socket_path, cbs.ready);
  json_socket.listen(socket, cbs.event);
  return socket;
}

function exitWithConnRefusedMsg(socket_path){
  fs.writeSync(process.stderr.fd,
      "unable to connect to ipc-file `" + socket_path + "`\n\n" +
      "1. the ipc file specified is invalid, or\n" +
      "2. the daemon process died unexpectedly\n");
  process.exit(1);
}

function getDaemonMessages(socket_path, cbs){
  var socket = connectToDaemon(socket_path, cbs);
  socket.on('error', function(error){
    if (error.code === 'ENOENT') {
      fs.writeSync(process.stderr.fd, "server not running\n");
      if(cbs.serverNotRunning) {
        // Caller wants to handle the condition of server not running,
        // so let them do it.
        cbs.serverNotRunning();
      } else {
        // Caller isn't prepared to deal with server not running, so die.
        process.exit(1);
      }
    } else if (error.code === 'ECONNREFUSED') {
      exitWithConnRefusedMsg(socket_path);
    } else {
      throw error;
    }
  });
  return socket;
}

function startScript(options, script, argv){
  var ipcFile = options['ipc-file'];
  var socket = connectToDaemon(ipcFile, {
    ready: function(){
      json_socket.send(socket, {
        action: 'NaughtStatus'
      });
    },
    event: function(msg){
      if (msg.event === 'Status') {
        fs.writeSync(process.stdout.fd, statusMsg(msg));
        process.exit(1);
      } else {
        printDaemonMsg(msg);
      }
    }
  });
  socket.on('error', onSocketError);

  function onSocketError(error) {
    socket.end();
    if (error.code === 'ECONNREFUSED') {
      if(options['remove-old-ipc']) {
        fs.writeSync(process.stderr.fd,
            "unable to connect to ipc-file `" + ipcFile + "`\n\n" +
            "removing the ipc-file and attempting to continue\n");
        fs.unlinkSync(ipcFile);
        startDaemon();
      } else {
        exitWithConnRefusedMsg(ipcFile);
      }
    } else if (error.code === 'ENOENT') {
      // no server running
      startDaemon();
    } else {
      throw error;
    }
  }

  function startDaemon(){
    var args = [
      options['worker-count'],
      path.resolve(CWD, ipcFile),
      resolveLogPath(options.log),
      resolveLogPath(options.stderr),
      resolveLogPath(options.stdout),
      options['max-log-size'],
      path.resolve(CWD, script),
      options['node-args'],
      options['pid-file']
    ].concat(argv);
    if (options['daemon-mode']) {
      startDaemonChild(args);
    } else {
      startBlockingMaster(args);
    }
  }

  function startBlockingMaster(args) {
    daemon.start(args);
  }

  function startDaemonChild(args) {
    var modulePath = path.resolve(__dirname, "start_daemon.js");
    var child = spawn(process.execPath, [modulePath].concat(args), {
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: true,
      cwd: options.cwd
    });
    child.unref();
    child.on('message', function(msg){
      if (msg.event === 'Error') {
        fs.writeSync(process.stderr.fd,
          "unable to start daemon: " + msg.value + "\n");
        process.exit(1);
      } else if (msg.event === 'IpcListening') {
        child.disconnect();
        var socket = connectToDaemon(ipcFile, {
          event: function(msg){
            if (msg.event === 'Ready') {
              process.stdout.write(statusMsg(msg));
              socket.end();
            } else if (msg.event === 'Shutdown') {
              console.error("The server crashed without booting. Check stderr.log.");
              socket.end();
              process.exit(1);
            } else {
              printDaemonMsg(msg);
            }
          }
        });
      } else {
        throw new Error("unexpected message from daemon");
      }
    });
  }
}

function resolveLogPath(logPath) {
  if (logPath === '-') {
    return '-';
  } else {
    return path.resolve(CWD, logPath);
  }
}

function stopScript(options, ipcFile){
  var socket = getDaemonMessages(ipcFile, {
    ready: function(){
      json_socket.send(socket, {
        action: 'NaughtShutdown',
        timeout: options.timeout
      });
    },
    event: function(msg){
      if (msg.event === 'Shutdown') {
        socket.end();
      } else if (msg.event === 'AlreadyShuttingDown') {
        console.error("Waiting for shutdown already in progress.");
        console.error("If it hangs, Ctrl+C this command and try it again with --timeout 1");
      } else {
        printDaemonMsg(msg);
      }
    },
    serverNotRunning: function() {
      // The server isn't running.
      // Who cares, we're trying to stop it anyway, this is not an error.
    }
  });
}

function workerCountsFromMsg(msg){
  if (!msg.count) return "Unknown";
  return "booting: " + msg.count.booting +
    ", online: " + msg.count.online +
    ", dying: " + msg.count.dying +
    ", new_online: " + msg.count.new_online;
}

function printDaemonMsg(msg){
  console.error(msg.event + ". " + workerCountsFromMsg(msg));
}

function statusMsg(msg){
  if (msg.count.booting > 0) {
    return "booting\n" + workerCountsFromMsg(msg) + "\n";
  } else if (msg['waiting_for'] === 'shutdown') {
    return "shutting down\n" + workerCountsFromMsg(msg) + "\n";
  } else if (msg['waiting_for'] != null) {
    return "deploy in progress\n" + workerCountsFromMsg(msg) + "\n";
  } else {
    return "workers online: " + msg.count.online + "\n";
  }
}

function deploy(options, ipcFile){
  var socket = getDaemonMessages(ipcFile, {
    ready: function(){
      setAbortKeyboardHook();
      json_socket.send(socket, {
        action: 'NaughtDeploy',
        newWorkerCount: options['worker-count'],
        environment: options['override-env'] ? process.env : {},
        timeout: options.timeout,
        cwd: path.resolve(options.cwd)
      });
    },
    event: function(msg){
      switch (msg.event) {
      case 'ErrorDeployInProgress':
        console.error("Deploy already in progress. Press Ctrl+C to abort.");
        break;
      case 'Shutdown':
        console.error("Bootup never succeeded. Check stderr.log and usage of 'online' and 'shutdown' events.");
        process.exit(1);
        break;
      case 'DeployFailed':
        console.log("Deploy failed. Check stderr.log and usage of 'online' and 'shutdown' events.");
        process.exit(1);
        break;
      case 'Ready':
        console.error("done");
        process.exit(0);
        break;
      default:
        printDaemonMsg(msg);
      }
    }
  });
  function setAbortKeyboardHook(){
    process.once('SIGINT', handleSigInt);
  }
  function handleSigInt(){
    console.error("aborting deploy");
    json_socket.send(socket, {
      action: 'NaughtDeployAbort'
    });
  }
}

function deployAbort(ipcFile){
  var socket = getDaemonMessages(ipcFile, {
    ready: function(){
      json_socket.send(socket, {
        action: 'NaughtDeployAbort'
      });
    },
    event: function(msg){
      switch (msg.event) {
      case 'ErrorNoDeployInProgress':
        console.error("no deploy in progress");
        process.exit(1);
        break;
      case 'Ready':
        console.error("deploy aborted");
        process.exit(0);
        break;
      default:
        printDaemonMsg(msg);
      }
    }
  });
}

function displayStatus(ipcFile){
  var socket = getDaemonMessages(ipcFile, {
    ready: function(){
      json_socket.send(socket, {
        action: 'NaughtStatus'
      });
    },
    event: function(msg){
      if (msg.event === 'Status') {
        process.stdout.write(statusMsg(msg));
        socket.end();
      } else {
        printDaemonMsg(msg);
      }
    }
  });
}

exports=module.exports=naught;
