#!/usr/bin/env node

var fs = require('fs');
var net = require('net');
var assert = require('assert');
var json_socket = require('./json_socket');
var spawn = require('child_process').spawn;
var path = require('path');
var DEFAULT_IPC_FILE = 'naught.ipc';
var DEFAULT_PID_FILE = 'naught.pid';
var CWD = process.cwd();
var cpuCount = require('os').cpus().length;
var daemon = require('./daemon');

var cmds = {
  start: {
    help: "naught start [options] server.js [script-options]\n\n" +

      "    Starts server.js as a daemon passing script-options as command\n" +
      "    line arguments.\n\n" +

      "    Each worker's stdout and stderr are redirected to a log files\n" +
      "    specified by the `stdout` and `stderr` parameters. When a log file\n" +
      "    becomes larger than `max-log-size`, the log file is renamed using the\n" +
      "    current date and time, and a new log file is opened.\n\n" +

      "    With naught, you can use `console.log` and friends. Because naught\n" +
      "    pipes the output into a log file, node.js treats stdout and stderr\n" +
      "    as asynchronous streams.\n\n" +

      "    If you don't want a particular log, use `/dev/null` for the path. Naught\n" +
      "    special cases this filename and disables that log altogether.\n\n" +

      "    When running in `daemon-mode` `false`, naught will start the master\n" +
      "    process and then block. It listens to SIGHUP for restarting and SIGTERM\n" +
      "    for stopping. In this situation you may use `-` for `stderr` and/or\n" +
      "    `stdout` which will redirect the respective streams to naught's output\n" +
      "    streams instead of a log file.\n\n" +

      "    Creates an `ipc-file` which naught uses to communicate with your\n" +
      "    server once it has started.\n\n" +

      "    Available options and their defaults:\n\n" +

      "    --worker-count 1\n" +
      "    --ipc-file " + DEFAULT_IPC_FILE + "\n" +
      "    --pid-file " + DEFAULT_PID_FILE + "\n" +
      "    --log naught.log\n" +
      "    --stdout stdout.log\n" +
      "    --stderr stderr.log\n" +
      "    --max-log-size 10485760\n" +
      "    --cwd " + CWD + "\n" +
      "    --daemon-mode true\n" +
      "    --node-args ''",
    fn: function(argv){
      var options = {
        'worker-count': '1',
        'ipc-file': DEFAULT_IPC_FILE,
        'pid-file': DEFAULT_PID_FILE,
        'log': 'naught.log',
        'stdout': 'stdout.log',
        'stderr': 'stderr.log',
        'max-log-size': '10485760',
        'cwd': CWD,
        'daemon-mode': 'true',
        'node-args': '',
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , script = arr[1];
      if (!err && script != null) {
        options['daemon-mode'] = options['daemon-mode'] === 'true';
        options['worker-count'] = parseInt(options['worker-count'], 10);
        if (isNaN(options['worker-count'])) return false;
        options['max-log-size'] = parseInt(options['max-log-size'], 10);
        if (isNaN(options['max-log-size'])) return false;
        startScript(options, script, argv);
        return true;
      } else {
        return false;
      }
    }
  },
  stop: {
    help: "naught stop [options] [ipc-file]\n\n" +

      "    Stops the running server which created `ipc-file`.\n" +
      "    Uses `" + DEFAULT_IPC_FILE + "` by default.\n\n" +

      "    This sends the 'shutdown' message to all the workers and waits for\n" +
      "    them to exit gracefully.\n\n" +

      "    If you specify a timeout, naught will forcefully kill your workers\n" +
      "    if they do not shut down gracefully within the timeout.\n\n" +

      "    Available options and their defaults:\n\n" +

      "        --timeout none\n" +
      "        --pid-file " + DEFAULT_PID_FILE,
    fn: function(argv){
      var options = { 
        'timeout': 'none',
        'pid-file': DEFAULT_PID_FILE
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , ipcFile = arr[1] || DEFAULT_IPC_FILE;
      if (!err && argv.length === 0) {
        options.timeout = parseFloat(options.timeout);
        if (isNaN(options.timeout)) {
          options.timeout = null;
        }
        stopScript(options, ipcFile);
        return true;
      } else {
        return false;
      }
    }
  },
  status: {
    help: "naught status [ipc-file]\n\n" +
      "    Displays whether a server is running or not.\n" +
      "    Uses `" + DEFAULT_IPC_FILE + "` by default.",
    fn: function(argv){
      if (argv.length > 1) {
        return false;
      }
      var ipcFile = argv[0] || DEFAULT_IPC_FILE;
      displayStatus(ipcFile);
      return true;
    }
  },
  deploy: {
    help: "naught deploy [options] [ipc-file]\n\n" +

      "    Replaces workers with new workers using new code and optionally\n" +
      "    the environment variables from this command.\n\n" +

      "    Naught spawns all the new workers and waits for them to all become\n" +
      "    online before killing a single old worker. This guarantees zero\n" +
      "    downtime if any of the new workers fail and provides the ability to\n" +
      "    cleanly abort the deployment if it hangs.\n\n" +

      "    A hanging deploy happens when a new worker fails to emit the 'online'\n" +
      "    message, or when an old worker fails to shutdown upon receiving the\n" +
      "    'shutdown' message. A keyboard interrupt will cause a deploy-abort,\n" +
      "    cleanly and with zero downtime.\n\n" +

      "    If `timeout` is specified, naught will automatically abort the deploy\n" +
      "    if it does not finish within those seconds.\n\n" +

      "    If `override-env` is true, the environment varibables that are set with\n" +
      "    this command are used to override the original environment variables\n" +
      "    used with the `start` command. If any variables are missing, the\n" +
      "    original values are left intact.\n\n" +

      "    `worker-count` can be used to change the number of workers running. A\n" +
      "    value of `0` means to keep the same number of workers.\n\n" +

      "    Uses `" + DEFAULT_IPC_FILE + "` by default.\n\n" +

      "    Available options and their defaults:\n\n" +

      "        --worker-count 0\n" +
      "        --override-env true\n" +
      "        --timeout none\n" +
      "        --cwd " + CWD,
    fn: function(argv){
      var options = {
        'worker-count': 0,
        'override-env': 'true',
        'timeout': 'none',
        'cwd': CWD
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , ipcFile = arr[1] || DEFAULT_IPC_FILE;
      if (!err && argv.length === 0) {
        options['override-env'] = options['override-env'] === 'true';
        options.timeout = parseFloat(options.timeout);
        if (isNaN(options.timeout)) options.timeout = null;

        options['worker-count'] = parseInt(options['worker-count'], 10);
        if (isNaN(options['worker-count'])) return false;

        deploy(options, ipcFile);
        return true;
      } else {
        return false;
      }
    }
  },
  'deploy-abort': {
    help: "naught deploy-abort [ipc-file]\n\n" +

      "    Aborts a hanging deploy. A hanging deploy happens when a new worker\n" +
      "    fails to emit the 'online' message, or when an old worker fails\n" +
      "    to shutdown upon receiving the 'shutdown' message.\n\n" +

      "    When deploying, a keyboard interrupt will cause a deploy-abort,\n" +
      "    so the times you actually have to run this command will be few and\n" +
      "    far between.\n\n" +

      "    Uses `" + DEFAULT_IPC_FILE + "` by default.",
    fn: function(argv){
      if (argv.length > 1) return false;
      var ipcFile = argv[0] || DEFAULT_IPC_FILE;
      deployAbort(ipcFile);
      return true;
    }
  },
  version: {
    help: "naught version\n\n" +

      "    Prints the version of naught and exits.",
    fn: function(argv) {
      if (argv) {
        if (argv.length > 0) return false;
        console.log(require('../package.json').version);
        return true;
      }
    },
  },
  help: {
    help: "naught help [cmd]\n\n" +

      "    Displays help for cmd.",
    fn: function(argv){
      var cmd;
      if (argv.length === 1 && (cmd = cmds[argv[0]]) != null) {
        console.log(cmd.help);
      } else {
        printUsage();
      }
      return true;
    }
  }
};

var cmd = cmds[process.argv[2]]
if (cmd) {
  if (!cmd.fn(process.argv.slice(3))) {
    console.error(cmd.help);
  }
} else {
  printUsage();
  process.exit(1);
}

function chompArgv(obj, argv){
  while (argv.length) {
    var arg = argv.shift();
    if (arg.indexOf('--') === 0) {
      var argName = arg.substring(2);
      if (!(argName in obj)) {
        return [new Error('InvalidArgument'), null];
      }
      if (argv.length === 0) {
        return [new Error('MissingArgument'), null];
      }
      obj[argName] = argv.shift();
    } else {
      return [null, arg];
    }
  }
  return [null, null];
}

function connectToDaemon(socket_path, cbs){
  var socket = net.connect(socket_path, cbs.ready);
  json_socket.listen(socket, cbs.event);
  return socket;
}

function assertErrorIsFromInvalidSocket(error){
  if (error.code !== 'ENOENT') {
    throw error;
  }
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
      process.exit(1);
    } else if (error.code === 'ECONNREFUSED') {
      exitWithConnRefusedMsg(socket_path);
    } else {
      throw error;
    }
  });
  return socket;
}

function printUsage(){
  for (var name in cmds) {
    var cmd = cmds[name];
    console.error("\n" + cmd.help + "\n");
  }
}

function startScript(options, script, argv){
  fs.writeFileSync(options['pid-file'], process.pid);
  
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
      exitWithConnRefusedMsg(ipcFile);
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
      cwd: options.cwd,
    });
    child.unref();
    child.on('message', function(msg){
      if (msg.event === 'Error') {
        fs.writeSync(process.stderr.fd,
          "unable to start daemon: " + msg.value + "\n");
        process.exit(1);
      } else if (msg.event === 'IpcListening') {
        child.disconnect();
        var sentShutdown = false;
        var socket = connectToDaemon(ipcFile, {
          event: function(msg){
            if (msg.event === 'Ready') {
              process.stdout.write(statusMsg(msg));
              socket.end();
            } else if (msg.event === 'Shutdown') {
              console.error("The server crashed without booting. Check stderr.log.");
              socket.end();
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
  if (fs.existsSync(options['pid-file']))
    fs.unlinkSync(options['pid-file']);
  
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
  } else if (msg.waiting_for === 'shutdown') {
    return "shutting down\n" + workerCountsFromMsg(msg) + "\n";
  } else if (msg.waiting_for != null) {
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
        cwd: options.cwd
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
