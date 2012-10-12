var fs, naught_bin, path, naught_main, assert, async, exec, spawn, steps, root, test_root, http, port, hostname, timeout, step_count, mkdirp, zlib, node_binary;

fs = require('fs');
mkdirp = require('mkdirp');
ncp = require('ncp').ncp;
rimraf = require('rimraf');
http = require('http');
spawn = require('child_process').spawn;
path = require("path");
assert = require("assert");
async = require("async");
zlib = require('zlib');

root = path.join(__dirname, "..");
test_root = path.join(root, "test");
naught_main = path.join(root, "lib", "main.js");
port = 11904;
hostname = 'localhost';
timeout = 5;
node_binary = process.env.NODE_BINARY || process.argv[0];

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
  exec(node_binary, [naught_main].concat(args), {
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
        assert.strictEqual(res.statusCode, 200);
        body = ""
        res.on('data', function(data) {
          body += data;
        });
        res.on('end', function() {
          assert.strictEqual(body, expected_resp);
          cb();
        });
      }).end();
    },
  };
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
        assert.strictEqual(stderr,
          "Bootup. booting: 1, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 0\n");
        assert.strictEqual(stdout, "workers online: 1\n")
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "starting a server twice prints the status of the running server",
    fn: function (cb) {
      naught_exec(["start", "server.js"], {}, function(stdout, stderr, code) {
        assert.strictEqual(stderr, "");
        assert.strictEqual(stdout, "workers online: 1\n");
        assert.strictEqual(code, 1)
        cb();
      });
    },
  },
  {
    info: "ability to query status of a running server",
    fn: function (cb) {
      naught_exec(["status"], {}, function(stdout, stderr, code) {
        assert.strictEqual(stderr, "");
        assert.strictEqual(stdout, "workers online: 1\n");
        assert.strictEqual(code, 0)
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
        assert.strictEqual(stderr,
          "SpawnNew. booting: 0, online: 1, dying: 0, new_booting: 1, new_online: 0\n" +
          "NewOnline. booting: 0, online: 1, dying: 0, new_booting: 0, new_online: 1\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 1\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 1\n" +
          "done\n");
        assert.strictEqual(stdout, "");
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  get("ability to change environment variables of workers", "/hi", "server2 hola"),
  {
    info: "ability to stop a running server",
    fn: function (cb) {
      naught_exec(["stop"], {}, function(stdout, stderr, code) {
        assert.strictEqual(stderr,
          "ShutdownOld. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
        assert.strictEqual(stdout, "");
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "stopping a server twice prints helpful output",
    fn: function (cb) {
      naught_exec(["stop"], {}, function(stdout, stderr, code) {
        assert.strictEqual(stdout, "");
        assert.strictEqual(stderr, "server not running\n");
        assert.strictEqual(code, 1)
        cb();
      });
    },
  },
  {
    info: "redirect stdout to log file",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "stdout.log"), "utf8", function (err, contents) {
        assert.strictEqual(contents, "server1 attempting to listen\n" +
          "server2 attempting to listen\n");
        cb();
      });
    },
  },
  {
    info: "redirect stderr to log file",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "stderr.log"), "utf8", function (err, contents) {
        assert.strictEqual(contents, "server1 listening\n" +
          "server2 listening\n");
        cb();
      });
    },
  },
  {
    info: "naught log contains events",
    fn: function (cb) {
      fs.readFile(path.join(test_root, "naught.log"), "utf8", function (err, contents) {
        assert.strictEqual(contents,
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
        assert.strictEqual(stderr,
          "Bootup. booting: 5, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 4, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 3, online: 2, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 2, online: 3, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 1, online: 4, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 5, dying: 0, new_booting: 0, new_online: 0\n");
        assert.strictEqual(stdout, "workers online: 5\n")
        assert.strictEqual(code, 0)
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
        assert.strictEqual(stderr,
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
        assert.strictEqual(stdout, "");
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "log rotation and gzipping: naught log",
    fn: function (cb) {
      collectLogFiles("log/naught", function (err, files, data) {
        if (err) return cb(err)
        assert.strictEqual(files.length, 4);
        assert.strictEqual(data,
          "Bootup. booting: 5, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 4, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 3, online: 2, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 2, online: 3, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 1, online: 4, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 5, dying: 0, new_booting: 0, new_online: 0\n" +
          "Ready. booting: 0, online: 5, dying: 0, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 4, dying: 1, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 3, dying: 2, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 2, dying: 3, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 1, dying: 4, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 5, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 4, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 3, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "Shutdown. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
        cb();
      });
    },
  },
  {
    info: "log rotation and gzipping: stderr log",
    fn: function (cb) {
      collectLogFiles("log/stderr", function (err, files, data) {
        if (err) return cb(err)
        assert.strictEqual(files.length, 2);
        assert.strictEqual(data,
          "server3 listening\n" +
          "server3 listening\n" +
          "server3 listening\n" +
          "server3 listening\n" +
          "server3 listening\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stderr abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n");
        cb();
      });
    },
  },
  {
    info: "log rotation and gzipping: stdout log",
    fn: function (cb) {
      collectLogFiles("log/stdout", function (err, files, data) {
        if (err) return cb(err)
        assert.strictEqual(files.length, 2);
        assert.strictEqual(data,
          "server3 attempting to listen\n" +
          "server3 attempting to listen\n" +
          "server3 attempting to listen\n" +
          "server3 attempting to listen\n" +
          "server3 attempting to listen\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n" +
          "3 stdout abcdefghijklmnopqrstuvwxyz123456789101121314151617181920\n");
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
        assert.strictEqual(stderr,
          "Bootup. booting: 2, online: 0, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 1, online: 1, dying: 0, new_booting: 0, new_online: 0\n" +
          "WorkerOnline. booting: 0, online: 2, dying: 0, new_booting: 0, new_online: 0\n");
        assert.strictEqual(stdout, "workers online: 2\n")
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  {
    info: "ability to stop a hanging server with a timeout",
    fn: function (cb) {
      naught_exec(["stop", "--timeout", "0.3"], {}, function(stdout, stderr, code) {
        assert.strictEqual(stderr,
          "ShutdownOld. booting: 0, online: 1, dying: 1, new_booting: 0, new_online: 0\n" +
          "ShutdownOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "DestroyOld. booting: 0, online: 0, dying: 2, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 1, new_booting: 0, new_online: 0\n" +
          "OldExit. booting: 0, online: 0, dying: 0, new_booting: 0, new_online: 0\n");
        assert.strictEqual(stdout, "");
        assert.strictEqual(code, 0)
        cb();
      });
    },
  },
  rm(["naught.log", "stderr.log", "stdout.log", "server.js"]),
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
