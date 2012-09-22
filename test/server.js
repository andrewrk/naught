var http, util;

http = require("http");
util = require("util");

console.log("stdout: attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/die") {
    throw new Error("unhandled exception");
  } else {
    resp.end('<html><head></head><body><p>hi</p></body></html>');
  }
}).listen(11904, function() {
  console.error("stderr: listening");
  process.send("online");
});
