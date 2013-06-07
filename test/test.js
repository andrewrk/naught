var fs = require('fs')
  , mkdirp = require('mkdirp')
  , ncp = require('ncp').ncp
  , rimraf = require('rimraf')
  , http = require('http')
  , spawn = require('child_process').spawn
  , path = require("path")
  , assert = require("assert")
  , async = require("async")
  , zlib = require('zlib')

var root = path.join(__dirname, "..")
  , test_root = path.join(root, "test")
  , naught_main = path.join(root, "lib", "main.js")
  , port = 11904
  , hostname = 'localhost'
  , timeout = 5


var steps = [
  {
    info: "version command",
    fn: function (cb) {
      naught_exec(["version"], {}, function(stdout, stderr, code) {
        assertEqual(stdout.trim(), require("../package.json").version);
        assertEqual(code, 0);
        cb();
      });
    },
  },
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
  get("make sure the server is up", "/hi", "server1 sup dawg"),
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
  get("ability to change environment variables of workers", "/hi", "server2 hola"),
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
          "--max-log-size", "300",
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
  get("command line arguments passed to server correctly", "/argv", "--custom1,aoeu,herp derp"),
  get("multi-worker server responding to get requests", "/stdout", "stdout3"),
  get("(test setup) generate log output", "/stderr", "stderr3"),
  get("(test setup) generate log output", "/stdout", "stdout3"),
  get("(test setup) generate log output", "/stderr", "stderr3"),
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
  use("server4.js"),
  {
    info: "(test setup) starting a server that won't shut down",
    fn: function (cb) {
      naught_exec(["start", "--worker-count", "2", "server.js"], {
        PORT: port,
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 2, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 1, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 2, dying: 0, new_booting: 0, new_online: 0\n");
        assertEqual(stdout, "workers online: 2\n")
        assertEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to stop a hanging server with a timeout",
    fn: function (cb) {
      naught_exec(["stop", "--timeout", "0.3"], {}, function(stdout, stderr, code) {
        assertEqual(stderr,
          "ShutdownOld. booting: 0, online: 1, dying: 1, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
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
      naught_exec([
          "start",
          "--node-args", "--harmony --use-strict",
          "--log", "/dev/null",
          "--stderr", "/dev/null",
          "--stdout", "/dev/null",
          "server5.js",
      ], {
        PORT: port,
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
  get("make sure --harmony --use-strict worked", "/hi", "0\n1\n2\nserver5 says hi\n"),
  {
    info: "(test setup) stopping server",
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
  use("server6.js"),
  {
    info: "(test setup) start server6 up",
    fn: function (cb) {
      naught_exec(["start", "server.js"], {
        PORT: port,
        hi: "server6 says hi",
      }, function(stdout, stderr, code) {
        assertEqual(stderr,
          "Bootup. booting: 1, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n");
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
            "Bootup. booting: 1, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
            "WorkerOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
            "Ready. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
            "WorkerOffline. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
            "SpawnNew. booting: 1, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
            "WorkerOnline. booting: 0, online: 1, dying: 1, new_booting: 0, new_online: 0\n" +
            "Ready. booting: 0, online: 1, dying: 1, new_booting: 0, new_online: 0\n" +
            "WorkerDeath. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n"
                     );
          cb();
        });
      }, 600);
    },
  },
  {
    info: "(test setup) stopping server",
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
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
];

var step_count = steps.length;
doStep();

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

function exec(cmd, args, opts, cb){
  var bin, stdout, stderr;
  if (args == null) args = []
  if (opts == null) opts = {}
  if (cb == null) cb = function(){};
  bin = spawn(cmd, args, opts);
  stdout = ""
  bin.stdout.setEncoding('utf8')
  bin.stdout.on('data', function(data) {
    stdout += data;
  });
  stderr = ""
  bin.stderr.setEncoding('utf8')
  bin.stderr.on('data', function(data) {
    stderr += data;
  });
  bin.on('close', function(code, signal) {
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
  exec(process.execPath, [naught_main].concat(args), {
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
        hostname: hostname,
        port: port,
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

function assertEqual(actual, expected, msg) {
  msg = msg || "";
  assert(actual === expected, "actual:\n" + actual + "\nexpected:\n" + expected + "\n" + msg);
}

