#!/usr/bin/env node

var fs = require('fs')
  , net = require('net')
  , assert = require('assert')
  , json_socket = require('./json_socket')
  , spawn = require('child_process').spawn
  , path = require('path')
  , DEFAULT_IPC_FILE = 'naught.ipc'
  , CWD = process.cwd()

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

      "    Creates an `ipc-file` which naught uses to communicate with your\n" +
      "    server once it has started.\n\n" +

      "    Available options and their defaults:\n\n" +

      "    --worker-count 1\n" +
      "    --ipc-file " + DEFAULT_IPC_FILE + "\n" +
      "    --log naught.log\n" +
      "    --stdout stdout.log\n" +
      "    --stderr stderr.log\n" +
      "    --max-log-size 10485760\n" +
      "    --cwd " + CWD + "\n" +
      "    --node-args ''",
    fn: function(argv){
      var options = {
        'worker-count': '1',
        'ipc-file': DEFAULT_IPC_FILE,
        'log': 'naught.log',
        'stdout': 'stdout.log',
        'stderr': 'stderr.log',
        'max-log-size': '10485760',
        'cwd': CWD,
        'node-args': ''
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , script = arr[1];
      if (!err && script != null) {
        options['worker-count'] = parseInt(options['worker-count'], 10);
        options['max-log-size'] = parseInt(options['max-log-size'], 10);
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

      "        --timeout none",
    fn: function(argv){
      var options = { timeout: 'none' };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , ipc_file = arr[1] || DEFAULT_IPC_FILE;
      if (!err && argv.length === 0) {
        options.timeout = parseFloat(options.timeout);
        if (isNaN(options.timeout)) {
          options.timeout = null;
        }
        stopScript(options, ipc_file);
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
      var ipc_file;
      if (argv.length > 1) {
        return false;
      }
      ipc_file = argv[0] || DEFAULT_IPC_FILE;
      displayStatus(ipc_file);
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

      "    Uses `" + DEFAULT_IPC_FILE + "` by default.\n\n" +

      "    Available options and their defaults:\n\n" +

      "        --override-env true\n        --timeout none",
    fn: function(argv){
      var options = {
        'override-env': 'true',
        'timeout': 'none'
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , ipc_file = arr[1] || DEFAULT_IPC_FILE;
      if (!err && argv.length === 0) {
        options['override-env'] = options['override-env'] === 'true';
        options.timeout = parseFloat(options.timeout);
        if (isNaN(options.timeout)) {
          options.timeout = null;
        }
        deploy(options, ipc_file);
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
      var ipc_file = argv[0] || DEFAULT_IPC_FILE;
      deployAbort(ipc_file);
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
  var arg, arg_name;
  while (argv.length) {
    arg = argv.shift();
    if (arg.indexOf('--') === 0) {
      arg_name = arg.substring(2);
      if (!(arg_name in obj)) {
        return [new Error('InvalidArgument'), null];
      }
      if (argv.length === 0) {
        return [new Error('MissingArgument'), null];
      }
      obj[arg_name] = argv.shift();
    } else {
      return [null, arg];
    }
  }
  return [null, null];
}

function connectToDaemon(socket_path, cbs){
  var socket;
  socket = net.connect(socket_path, cbs.ready);
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
  var ipc_file = options['ipc-file'];
  var socket = connectToDaemon(ipc_file, {
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
  socket.on('error', function(error){
    var child;
    socket.end();
    if (error.code === 'ECONNREFUSED') {
      exitWithConnRefusedMsg(options['ipc-file']);
    } else if (error.code === 'ENOENT') {
      // no server running
      child = spawn(process.execPath, [
        path.resolve(__dirname, "daemon.js"),
        options['worker-count'],
        path.resolve(CWD, options['ipc-file']),
        path.resolve(CWD, options.log),
        path.resolve(CWD, options.stderr),
        path.resolve(CWD, options.stdout),
        options['max-log-size'],
        path.resolve(CWD, script),
        options['node-args']
      ].concat(argv), {
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        detached: true,
        cwd: options.cwd
      });
      child.unref();
      child.on('message', function(msg){
        assert(msg === 'IpcListening');
        child.disconnect();
        var sentShutdown = false;
        var socket = connectToDaemon(options['ipc-file'], {
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
      });
    } else {
      throw error;
    }
  });
}

function stopScript(options, ipc_file){
  var socket = getDaemonMessages(ipc_file, {
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

function deploy(options, ipc_file){
  var socket = getDaemonMessages(ipc_file, {
    ready: function(){
      setAbortKeyboardHook();
      json_socket.send(socket, {
        action: 'NaughtDeploy',
        environment: options['override-env'] ? process.env : {},
        timeout: options.timeout
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

function deployAbort(ipc_file){
  var socket = getDaemonMessages(ipc_file, {
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

function displayStatus(ipc_file){
  var socket = getDaemonMessages(ipc_file, {
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
