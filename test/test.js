var fs, naught_bin, path, naught_main, assert, async, exec, spawn, steps, root, test_root, http, port, hostname, timeout, step_count, fse;

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

function use(script) {
  return {
    info: "(test setup) use " + script,
    fn: function (cb) {
      fse.copy(path.join(test_root, script), path.join(test_root, "server.js"), cb);
    },
  };
}

function mkdir(dir) {
  return {
    info: "(test setup) mkdir " + dir,
    fn: function (cb) {
      fse.mkdir(path.join(test_root, dir), cb);
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
        fse.remove(path.join(test_root, item), cb);
      }, cb);
    },
  }
}

steps = [
  use("server1.js"),
  {
    info: "ability to start a server",
    fn: function (cb) {
      naught_exec(["start", "server.js"], {
        PORT: port,
        hi: "sup dawg",
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 1, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n");
        assertEqual(stdout, "workers online: 1\n")
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
        assertEqual(stdout, "workers online: 1\n");
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
        assertEqual(stdout, "workers online: 1\n");
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
  use("server2.js"),
  {
    info: "ability to deploy to a running server",
    fn: function (cb) {
      naught_exec(["deploy"], {hi: "hola"}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "SpawnNew. booting: 0, online: 1, dying: 0, new_booting: 1, new_online: 0\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 1\n" +
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
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
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
    info: "redirect stdout to log file",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "stdout.log"), "utf8", function (err, contents) {
        assertEqual(contents, "server1 attempting to listen\n" +
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
          "server2 listening\n");
        cb();
      });
    },
  },
  {
    info: "naught log contains events",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "naught.log"), "utf8", function (err, contents) {
        assertEqual(contents,
          "Bootup. booting: 1, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "Ready. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "Status. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "Status. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "SpawnNew. booting: 0, online: 1, dying: 0, new_booting: 1, new_online: 0\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 1\n" +
          "Ready. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "Shutdown. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
        cb();
      });
    },
  },
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
  use("server3.js"),
  mkdir("foo"),
  {
    info: "cli accepts non-default args",
    fn: function (cb) {
      naught_exec([
          "start",
          "--worker-count", "5",
          "--ipc-file", "some/dir/ipc",
          "--log", "log/naught/a.log",
          "--stderr", "log/stderr/b",
          "--stdout", "log/stdout/c.",
          "--max-log-size", "100",
          "--cwd", "foo",
          "server.js",
          "--custom1", "aoeu",
          "herp derp",
      ], {
        PORT: port,
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 5, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 4, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 3, online: 2, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 2, online: 3, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 1, online: 4, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 5, dying: 0, new_booting: 0, new_online: 0\n");
        assertEqual(stdout, "workers online: 5\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to stop a running server with multiple workers",
    fn: function (cb) {
      naught_exec(["stop", "some/dir/ipc"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 4, dying: 1, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 3, dying: 2, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 2, dying: 3, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 1, dying: 4, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 5, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 4, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 3, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
        assertEqual(stdout, "");
        assertEqual(code, 0)
        cb();
      });
    },
  },
  remove(["foo", "log", "some", "server.js"]),
];

function doStep() {
  var step, interval;

  step = steps.shift();
  process.stderr.write(step.info + "...")
  interval = setTimeout(function() {
    fs.writeSync(process.stderr.fd, "timeout\n")
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
