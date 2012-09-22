var fs, naught_bin, path, naught_main, assert, async, exec, spawn, steps, root, test_root, http, port, hostname, timeout, step_count, fse, v1_code, v2_code, serverjs;

fs = require('fs');
fse = require('fs-extra');
http = require('http');
spawn = require('child_process').spawn;
path = require("path");
assert = require("assert");
async = require("async");

root = path.join(__dirname, "..");
test_root = path.join(root, "test");
naught_main = path.join(root, "lib", "main.js");
v1_code = path.join(test_root, "server1.js")
v2_code = path.join(test_root, "server2.js")
serverjs = path.join(test_root, "server.js")
port = 11904;
hostname = 'localhost';
timeout = 5;

function assertEqual(actual, expected) {
  assert(actual === expected, "actual:\n" + actual + "\nexpected:\n" + expected);
}

function exec(cmd, args, opts, cb){
  var bin, stdout, stderr;
  if (args == null) args = []
  if (opts == null) opts = {}
  if (cb == null) cb = function(){};
  bin = spawn(cmd, args, opts);
  stdout = ""
  bin.stdout.on('data', function(data) {
    stdout += data;
  });
  stderr = ""
  bin.stderr.on('data', function(data) {
    stderr += data;
  });
  bin.on('exit', function(code, signal) {
    cb(stdout, stderr, code, signal);
  });
}

function import$(obj, src){
  var key, own = {}.hasOwnProperty;
  for (key in src) if (own.call(src, key)) obj[key] = src[key];
  return obj;
}

function naught_exec(args, env, cb) {
  if (env == null) env = {}
  import$(import$({}, process.env), env)
  exec("node", [naught_main].concat(args), {
    cwd: __dirname,
    env: env
  }, function(stdout, stderr, code, signal) {
    cb(stdout, stderr, code);
  });
}

steps = [
  {
    info: "use version 1 of the server code",
    fn: function (cb) {
      fse.copy(v1_code, serverjs, cb);
    },
  },
  {
    info: "ability to start a server",
    fn: function (cb) {
      naught_exec(["start", "server.js"], {
        PORT: port,
        hi: "sup dawg",
      }, function(stdout, stderr, code) {
        assertEqual(stderr, "event: Bootup, old: 0, new: 0, dying: 0\n")
        assertEqual(stdout, "server is running\nworkers online: 1\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "starting a server twice prints the status of the running server",
    fn: function (cb) {
      naught_exec(["start", "server.js"], {}, function(stdout, stderr, code) {
        assertEqual(stderr, "");
        assertEqual(stdout, "server is running\nworkers online: 1\n");
        assertEqual(code, 1)
        cb();
      });
    },
  },
  {
    info: "ability to query status of a running server",
    fn: function (cb) {
      naught_exec(["status"], {}, function(stdout, stderr, code) {
        assertEqual(stderr, "");
        assertEqual(stdout, "server is running\nworkers online: 1\n");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "make sure the server is up",
    fn: function (cb) {
      http.request({
        hostname: hostname,
        port: port,
        path: "/hi",
      }, function (res) {
        var body;
        assertEqual(res.statusCode, 200);
        body = ""
        res.on('data', function(data) {
          body += data;
        });
        res.on('end', function() {
          assertEqual(body, "server1 sup dawg");
          cb();
        });
      }).end();
    },
  },
  {
    info: "use version 2 of the server code",
    fn: function (cb) {
      fse.copy(v2_code, serverjs, cb);
    },
  },
  {
    info: "ability to deploy to a running server",
    fn: function (cb) {
      naught_exec(["deploy"], {hi: "hola"}, function(stdout, stderr, code) {
        assertEqual(stderr, "event: SpawnNew, old: 1, new: 0, dying: 0\n" +
          "event: NewOnline, old: 1, new: 1, dying: 0\n" +
          "event: ShutdownOld, old: 1, new: 1, dying: 0\n" +
          "event: OldExit, old: 0, new: 1, dying: 1\n" +
          "done\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to change environment variables of workers",
    fn: function (cb) {
      http.request({
        hostname: hostname,
        port: port,
        path: "/hi",
      }, function (res) {
        var body;
        assertEqual(res.statusCode, 200);
        body = ""
        res.on('data', function(data) {
          body += data;
        });
        res.on('end', function() {
          assertEqual(body, "server2 hola");
          cb();
        });
      }).end();
    },
  },
  {
    info: "ability to stop a running server",
    fn: function (cb) {
      naught_exec(["stop"], {}, function(stdout, stderr, code) {
        assertEqual(stderr, "event: ShutdownOld, old: 1, new: 0, dying: 0\nevent: OldExit, old: 0, new: 0, dying: 1\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "stopping a server twice prints helpful output",
    fn: function (cb) {
    naught_exec(["stop"], {}, function(stdout, stderr, code) {
      assertEqual(stdout, "");
      assertEqual(stderr, "server not running\n");
      assertEqual(code, 1)
      cb();
    });
  },
  },
  {
    info: "server writes to default log files",
    fn: function (cb) {
      async.parallel([
        function (cb) {
          fs.unlink(path.join(test_root, "naught.log"), cb);
        },
        function (cb) {
          fs.unlink(path.join(test_root, "stderr.log"), cb);
        },
        function (cb) {
          fs.unlink(path.join(test_root, "stdout.log"), cb);
        },
        function (cb) {
          fs.unlink(serverjs, cb);
        },
      ], cb);
    },
  },
];

function doStep() {
  var step, interval;

  step = steps.shift();
  process.stderr.write(step.info + "...")
  interval = setTimeout(function() {
    process.stderr.write("timeout\n");
    process.exit(1);
  }, timeout * 1000);
  step.fn(function (err) {
    assert.ifError(err);
    clearTimeout(interval);
    process.stderr.write("pass\n");
    if (steps.length === 0) {
      process.stderr.write(step_count + " tests passed\n");
    } else {
      doStep();
    }
  });
}

step_count = steps.length;
doStep();
