var exec;

exec = require("child_process").exec;

function doTest() {
  exec("naught start server.js", {
    cwd: __dirname
  }, function(error, stdout, stderr) {

  });
  naught start server.js
  assert server is running
  hit localhost:11600/die
  assert server is running
}
