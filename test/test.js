var fs = require('fs');
var mkdirp = require('mkdirp');
var ncp = require('ncp').ncp;
var rimraf = require('rimraf');
var http = require('http');
var spawn = require('child_process').spawn;
var fork = require('child_process').fork;
var path = require("path");
var assert = require("assert");
var async = require("async");
var zlib = require('zlib');
var assertDeepEqual = require('whynoteq').assertDeepEqual;

var root = path.join(__dirname, "..");
var test_root = path.join(root, "test");
var NAUGHT_MAIN = path.join(root, "lib", "main.js");
var PORT = 11904;
var HOSTNAME = 'localhost';
var TIMEOUT = 5000;


// naught child process when runnning in no daemon mode
var bin;

var steps = [
  {
    info: "version command",
    fn: function (cb) {
      naughtExec(["version"], {}, function(stdout, stderr, code) {
        assertEqual(stdout.trim(), require("../package.json").version);
        assertEqual(code, 0);
        cb();
      });
    },
  },
  use("server1.js"),
  {
    info: "should get error message when starting with invalid path",
    fn: function(cb) {
      naughtExec(["start", "--ipc-file", "/invalid/path/foo.ipc", "server.js"], {},
          function(stdout, stderr, code)
      {
        assertEqual(stderr, "unable to start daemon: EACCES, mkdir '/invalid'\n");
        assertEqual(stdout, "");
        assertEqual(code, 1);
        cb();
      });
    },
  },
  {
    info: "ability to start a server",
    fn: function (cb) {
      naughtExec(["start", "server.js"], {
        PORT: PORT,
        hi: "sup dawg",
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 1\n");
        assertEqual(stdout, "workers online: 1\n");
        assertEqual(code, 0);
        cb();
      });
    },
  },
  {
    info: "starting a server twice prints the status of the running server",
    fn: function (cb) {
      naughtExec(["start", "server.js"], {}, function(stdout, stderr, code) {
        assertEqual(stderr, "");
        assertEqual(stdout, "workers online: 1\n");
        assertEqual(code, 1);
        cb();
      });
    },
  },
  {
    info: "ability to query status of a running server",
    fn: function (cb) {
      naughtExec(["status"], {}, function(stdout, stderr, code) {
        assertEqual(stderr, "");
        assertEqual(stdout, "workers online: 1\n");
        assertEqual(code, 0);
        cb();
      });
    },
  },
  get("make sure the server is up", "/hi", "server1 sup dawg"),
  use("server2.js"),
  {
    info: "ability to deploy to a running server",
    fn: function (cb) {
      naughtExec(["deploy"], {hi: "hola"}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "SpawnNew. booting: 1, online: 1, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 1\n" +
          "done\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to deploy and increase workers count",
    fn: function (cb) {
      naughtExec(["deploy", "--worker-count", "2"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "SpawnNew. booting: 1, online: 1, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 2, online: 1, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 1, online: 1, dying: 0, new_online: 1\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_online: 2\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 2\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 2\n" +
          "done\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to deploy and decrease workers count",
    fn: function (cb) {
      naughtExec(["deploy", "--worker-count", "1"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "SpawnNew. booting: 1, online: 2, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 2, dying: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 1, dying: 1, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 2, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 1\n" +
          "done\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  get("ability to change environment variables of workers", "/hi", "server2 hola"),
  {
    info: "ability to stop a running server",
    fn: function (cb) {
      naughtExec(["stop"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "stopping a server twice prints helpful output",
    fn: function (cb) {
      naughtExec(["stop"], {}, function(stdout, stderr, code) {
        assertEqual(stdout, "");
        assertEqual(stderr, "server not running\n");
        assertEqual(code, 1)
        cb();
      });
    },
  },
  {
    info: "redirect stdout to log file",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "stdout.log"), "utf8", function (err, contents) {
        assertEqual(contents, "server1 attempting to listen\n" +
          "server2 attempting to listen\n" +
          "server2 attempting to listen\n" +
          "server2 attempting to listen\n" +
          "server2 attempting to listen\n");
        cb();
      });
    },
  },
  {
    info: "redirect stderr to log file",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "stderr.log"), "utf8", function (err, contents) {
        assertEqual(contents, "server1 listening\n" +
          "server2 listening\n" +
          "server2 listening\n" +
          "server2 listening\n" +
          "server2 listening\n");
        cb();
      });
    },
  },
  {
    info: "naught log contains events",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "naught.log"), "utf8", function (err, contents) {
        assertEqual(contents, "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 1\n" +
          "Ready. booting: 0, online: 1, dying: 0, new_online: 0\n" +
          "Status. booting: 0, online: 1, dying: 0, new_online: 0\n" +
          "Status. booting: 0, online: 1, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 1, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 1\n" +
          "Ready. booting: 0, online: 1, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 1, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 2, online: 1, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 1, online: 1, dying: 0, new_online: 1\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_online: 2\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 2\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 2\n" +
          "Ready. booting: 0, online: 2, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 2, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 2, dying: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 1, dying: 1, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 2, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 1\n" +
          "Ready. booting: 0, online: 1, dying: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "Shutdown. booting: 0, online: 0, dying: 0, new_online: 0\n");
        cb();
      });
    },
  },
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
  use("server1.js"),
  {
    info: "start server in no daemon mode",
    fn: function (cb) {
      var expectedMessages = [
        {
          event: 'IpcListening',
        },
        {
          event: 'Bootup',
          waitingFor: null,
          count: {
            booting: 0,
            online: 0,
            dying: 0,
            new_online: 0,
          },
        },
        {
          event: 'SpawnNew',
          waitingFor: 'new',
          count: {
            booting: 1,
            online: 0,
            dying: 0,
            new_online: 0,
          },
        },
        {
          event: 'NewOnline',
          waitingFor: 'new',
          count: {
            booting: 0,
            online: 0,
            dying: 0,
            new_online: 1,
          },
        },
      ];
      naughtSpawn(["start", "--daemon-mode", "false", "server.js"], {
        PORT: PORT,
        hi: "no daemons here",
      });
      expectMessages(expectedMessages, cb);
    },
  },
  get("make sure the server is up", "/hi", "server1 no daemons here"),
  use("server2.js"),
  {
    info: "SIGHUP in no daemon mode causes a deploy",
    fn: function (cb) {
      var expectedMessages = [
        {
          event: 'SpawnNew',
          waitingFor: 'new',
          count: {
            booting: 1,
            online: 1,
            dying: 0,
            new_online: 0,
          },
        },
        {
          event: 'NewOnline',
          waitingFor: 'new',
          count: {
            booting: 0,
            online: 1,
            dying: 0,
            new_online: 1,
          },
        },
        {
          event: 'ShutdownOld',
          waitingFor: 'old',
          count: {
            booting: 0,
            online: 0,
            dying: 1,
            new_online: 1,
          },
        },
        {
          event: 'OldExit',
          waitingFor: 'old',
          count: {
            booting: 0,
            online: 0,
            dying: 0,
            new_online: 1,
          },
        },
        {
          event: 'Ready',
          waitingFor: null,
          count: {
            booting: 0,
            online: 1,
            dying: 0,
            new_online: 0,
          },
        },
      ];
      expectMessages(expectedMessages, cb);
      bin.kill('SIGHUP');
    },
  },
  get("make sure the deploy worked", "/hi", "server2 no daemons here"),
  {
    info: "SIGTERM in no daemon mode causes a stop",
    fn: function (cb) {
      var expectedMessages = [
        {
          event: 'ShutdownOld',
          waitingFor: 'shutdown',
          count: {
            booting: 0,
            online: 0,
            dying: 1,
            new_online: 0,
          },
        },
        {
          event: 'OldExit',
          waitingFor: 'shutdown',
          count: {
            booting: 0,
            online: 0,
            dying: 0,
            new_online: 0,
          },
        },
      ];

      var exited = false;
      bin.on('exit', function(code) {
        assert.strictEqual(code, 0);
        exited = true;
        done();
      });

      var gotMessages = false;
      expectMessages(expectedMessages, function() {
        gotMessages = true;
        done();
      });
      bin.kill('SIGTERM');

      function done() {
        if (exited && gotMessages) cb();
      }
    },
  },
  use("server3.js"),
  mkdir("foo"),
  {
    info: "cli accepts non-default args",
    fn: function (cb) {
      naughtExec([
          "start",
          "--worker-count", "5",
          "--ipc-file", "some/dir/ipc",
          "--log", "log/naught/a.log",
          "--stderr", "log/stderr/b",
          "--stdout", "log/stdout/c.",
          "--max-log-size", "300",
          "--cwd", "foo",
          "server.js",
          "--custom1", "aoeu",
          "herp derp",
      ], {
        PORT: PORT,
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 2, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 3, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 4, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 5, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 4, online: 0, dying: 0, new_online: 1\n" +
          "NewOnline. booting: 3, online: 0, dying: 0, new_online: 2\n" +
          "NewOnline. booting: 2, online: 0, dying: 0, new_online: 3\n" +
          "NewOnline. booting: 1, online: 0, dying: 0, new_online: 4\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 5\n");
        assertEqual(stdout, "workers online: 5\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  get("command line arguments passed to server correctly", "/argv", "--custom1,aoeu,herp derp"),
  get("multi-worker server responding to get requests", "/stdout", "stdout3"),
  get("(test setup) generate log output", "/stderr", "stderr3"),
  get("(test setup) generate log output", "/stdout", "stdout3"),
  get("(test setup) generate log output", "/stderr", "stderr3"),
  {
    info: "ability to stop a running server with multiple workers",
    fn: function (cb) {
      naughtExec(["stop", "some/dir/ipc"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 4, dying: 1, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 3, dying: 2, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 2, dying: 3, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 1, dying: 4, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 5, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 4, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 3, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 2, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  remove(["foo", "log", "some", "server.js"]),
  use("server4.js"),
  {
    info: "(test setup) starting a server that won't shut down",
    fn: function (cb) {
      naughtExec(["start", "--worker-count", "2", "server.js"], {
        PORT: PORT,
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 2, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 1, online: 0, dying: 0, new_online: 1\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 2\n");
        assertEqual(stdout, "workers online: 2\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to stop a hanging server with a timeout",
    fn: function (cb) {
      naughtExec(["stop", "--timeout", "0.3"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 1, dying: 1, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 2, new_online: 0\n" +
          "Timeout. booting: 0, online: 0, dying: 2, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
  {
    info: "ability to pass command line arguments to node",
    fn: function (cb) {
      naughtExec([
          "start",
          "--node-args", "--harmony --use-strict",
          "--log", "/dev/null",
          "--stderr", "/dev/null",
          "--stdout", "/dev/null",
          "server5.js",
      ], {
        PORT: PORT,
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 1\n");
        assertEqual(stdout, "workers online: 1\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  get("make sure --harmony --use-strict worked", "/hi", "0\n1\n2\nserver5 says hi\n"),
  {
    info: "(test setup) stopping server",
    fn: function (cb) {
      naughtExec(["stop"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  use("server6.js"),
  {
    info: "(test setup) start server6 up",
    fn: function (cb) {
      naughtExec(["start", "server.js"], {
        PORT: PORT,
        hi: "server6 says hi",
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
          "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
          "NewOnline. booting: 0, online: 0, dying: 0, new_online: 1\n");
        assertEqual(stdout, "workers online: 1\n")
        assertEqual(code, 0)
        cb();
      });
    }
  },
  get("(test setup) have server send offline message", "/offline", "Going offline"),
  {
    info: "make sure offline message spawns a new server",
    fn: function (cb) {
      // Wait for the server to go offline, spawn a new one, and have the old one die
      setTimeout(function() {
        fs.readFile(path.join(test_root, "naught.log"), "utf8", function (err, contents) {
          assertEqual(contents,
            "Bootup. booting: 0, online: 0, dying: 0, new_online: 0\n" +
            "SpawnNew. booting: 1, online: 0, dying: 0, new_online: 0\n" +
            "NewOnline. booting: 0, online: 0, dying: 0, new_online: 1\n" +
            "Ready. booting: 0, online: 1, dying: 0, new_online: 0\n" +
            "WorkerOffline. booting: 0, online: 0, dying: 1, new_online: 0\n" +
            "SpawnNew. booting: 1, online: 0, dying: 1, new_online: 0\n" +
            "WorkerOnline. booting: 0, online: 1, dying: 1, new_online: 0\n" +
            "Ready. booting: 0, online: 1, dying: 1, new_online: 0\n" +
            "WorkerDeath. booting: 0, online: 1, dying: 0, new_online: 0\n"
                     );
          cb();
        });
      }, 600);
    },
  },
  {
    info: "(test setup) stopping server",
    fn: function (cb) {
      naughtExec(["stop"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
];

var stepCount = steps.length;

cleanUp();
doStep();

function cleanUp() {
  console.log("** Cleaning up previous tests content.")
  deleteIfPresent(path.join(test_root, "stdout.log"));
  deleteIfPresent(path.join(test_root, "stderr.log"));
  deleteIfPresent(path.join(test_root, "naught.log"));
  console.log("** Done cleaning up.")
}

function deleteIfPresent(filename) {
  if (fs.existsSync(filename)) {
    fs.unlinkSync(filename);
  }
}

function doStep() {
  var step = steps.shift();
  process.stderr.write(step.info + "...")
  var interval = setTimeout(function() {
    fs.writeSync(process.stderr.fd, "timeout\n")
    process.exit(1);
  }, TIMEOUT);
  step.fn(function (err) {
    assert.ifError(err);
    clearTimeout(interval);
    process.stderr.write("pass\n");
    if (steps.length === 0) {
      process.stderr.write(stepCount + " tests passed\n");
    } else {
      doStep();
    }
  });
}

function exec(cmd, args, opts, cb){
  if (args == null) args = [];
  if (opts == null) opts = {};
  if (cb == null) cb = noop;
  var bin = spawn(cmd, args, opts);
  var stdout = ""
  bin.stdout.setEncoding('utf8')
  bin.stdout.on('data', function(data) {
    stdout += data;
  });
  var stderr = ""
  bin.stderr.setEncoding('utf8')
  bin.stderr.on('data', function(data) {
    stderr += data;
  });
  bin.on('close', function(code, signal) {
    cb(stdout, stderr, code, signal);
  });
}

function extend(obj, src) {
  for (var key in src) {
    obj[key] = src[key];
  }
  return obj;
}

function naughtSpawn(args, env, cb) {
  env = extend(extend({}, process.env), env || {});
  bin = fork(NAUGHT_MAIN, args, {
    cwd: __dirname,
    env: env,
  });
}

function naughtExec(args, env, cb) {
  env = extend(extend({}, process.env), env || {});
  exec(process.execPath, [NAUGHT_MAIN].concat(args), {
    cwd: __dirname,
    env: env
  }, function(stdout, stderr, code, signal) {
    cb(stdout, stderr, code);
  });
}

function collectLogFiles(test_path, cb) {
  fs.readdir(path.join(test_root, test_path), function (err, files) {
    if (err) return cb(err);
    files.sort()
    if (! /\.gz$/.test(files[0])) {
      files.push(files.shift());
    }
    async.map(files, function (file, cb) {
      fs.readFile(path.join(test_root, test_path, file), function (err, data) {
        if (err) return cb(err);
        if (/\.gz$/.test(file)) {
          zlib.gunzip(data, function (err, data) {
            if (err) return cb(err);
            cb(null, {file: file, data: data});
          });
        } else {
          cb(null, {file: file, data: data});
        }
      });
    }, function (err, results) {
      if (err) return cb(err);
      var full_data;
      full_data = "";
      results.forEach(function(item) {
        full_data += item.data.toString();
      });
      cb(null, results, full_data);
    });
  });
}

function use(script) {
  return {
    info: "(test setup) use " + script,
    fn: function (cb) {
      ncp(path.join(test_root, script), path.join(test_root, "server.js"), cb);
    },
  };
}

function mkdir(dir) {
  return {
    info: "(test setup) mkdir " + dir,
    fn: function (cb) {
      mkdirp(path.join(test_root, dir), cb);
    },
  };
}

function rm(files) {
  return {
    info: "(test setup) rm " + files.join(" "),
    fn: function (cb) {
      async.forEach(files, function (item, cb) {
        fs.unlink(path.join(test_root, item), cb);
      }, cb);
    },
  }
}

function remove(files) {
  return {
    info: "(test setup) rm -rf " + files.join(" "),
    fn: function (cb) {
      async.forEach(files, function (item, cb) {
        rimraf(path.join(test_root, item), cb);
      }, cb);
    },
  }
}

function get(info, url, expected_resp) {
  return {
    info: info,
    fn: function (cb) {
      http.request({
        hostname: HOSTNAME,
        port: PORT,
        path: url,
      }, function (res) {
        var body;
        assertEqual(res.statusCode, 200);
        body = ""
        res.on('data', function(data) {
          body += data;
        });
        res.on('end', function() {
          assertEqual(body, expected_resp);
          cb();
        });
      }).end();
    },
  };
}

function expectMessages(msgList, cb) {
  bin.on('message', onMessage);

  function onMessage(message) {
    var expected = msgList.shift();
    assertDeepEqual(message, expected, "expected: " +
        JSON.stringify(expected, null, 2) +
        "\ngot: " + JSON.stringify(message, null, 2));
    if (msgList.length === 0) {
      bin.removeListener('message', onMessage);
      cb();
    }
  }
}

function assertEqual(actual, expected, msg) {
  msg = msg || "";
  assert(actual === expected, "actual:\n" + actual + "\nexpected:\n" + expected + "\n" + msg);
}

function noop() {}
