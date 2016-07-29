var fs = require('fs');
var os = require('os');
var net = require('net');
var assert = require('assert');
var json_socket = require('./json_socket');
var path = require('path');
var DEFAULT_IPC_FILE = 'naught.ipc';
var DEFAULT_PID_FILE = 'naught.pid';
var CWD = process.cwd();
var daemon = require('./daemon');
var naught = require('./naught');
var packageJson = require('../package.json');

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
      "    --remove-old-ipc false\n" +
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
        'remove-old-ipc': 'false',
        'node-args': ''
      };
      var arr = chompArgv(options, argv)
        , err = arr[0]
        , script = arr[1];
      if (!err && script != null) {
        options['daemon-mode'] = options['daemon-mode'] === 'true';
        options['remove-old-ipc'] = options['remove-old-ipc'] === 'true';
        options['worker-count'] = extendedWorkerCount(options['worker-count']);
        if (isNaN(options['worker-count'])) return false;
        options['max-log-size'] = parseInt(options['max-log-size'], 10);
        if (isNaN(options['max-log-size'])) return false;
        naught.start(options, script, argv);
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
        naught.stop(options, ipcFile);
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
      naught.status(ipcFile);
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
      "    value of `0` means to keep the same number of workers.\n" +
      "    A value of 'auto', will set value as per the number of available CPUs.\n\n" +

      "    `cwd` can be used to change the cwd directory of the master process.\n" +
      "    This allows you to release in different directories. Unfortunately,\n" +
      "    this option doesn't update the script location. For example, if you\n" +
      "    start naught `naught start --cwd /release/1 server.js` and deploy\n" +
      "    `naught deploy --cwd /release/2` the script file will not change from\n" +
      "    '/release/1/server.js' to '/release/2/server.js'. You have to create\n" +
      "    a symlink and pass the full symlink path to naught start\n" +
      "    '/current/server.js'. After creating the symlink naught starts the\n" +
      "    correct script, but the cwd is still old and require loads files from\n" +
      "    from the old directory. The cwd option allows you to update the cwd\n" +
      "    to the new directory. It defaults to naught's cwd.\n\n" +

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

        naught.deploy(options, ipcFile);
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
      naught.deployAbort(ipcFile);
      return true;
    }
  },
  version: {
    help: "naught version\n\n" +

      "    Prints the version of naught and exits.",
    fn: function(argv) {
      if (argv) {
        if (argv.length > 0) return false;
        console.log(packageJson.version);
        return true;
      }
    }
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

var cmd = cmds[process.argv[2]];
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

function exitWithConnRefusedMsg(socket_path){
  fs.writeSync(process.stderr.fd,
      "unable to connect to ipc-file `" + socket_path + "`\n\n" +
      "1. the ipc file specified is invalid, or\n" +
      "2. the daemon process died unexpectedly\n");
  process.exit(1);
}

function printUsage(){
  for (var name in cmds) {
    var cmd = cmds[name];
    console.error("\n" + cmd.help + "\n");
  }
}

function extendedWorkerCount(workerCount){
  if (workerCount === 'auto'){
    return os.cpus().length;
  } else {
    return parseInt(workerCount, 10);
  }
}
